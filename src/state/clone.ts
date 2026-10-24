import { createBudget, type Budget, type TraversalOptions } from '../internal/budget.ts';
import { assertOptionsObject } from '../internal/validate.ts';
import { assertUsableBuffer, hasOnlyIntrinsicKeys, kindOf, typedArrayConstructors, type TypedArray } from './builtins.ts';
import { StateError } from './state-error.ts';

/** Method key for custom clone hooks on classes. */
export const CLONE_SYMBOL: unique symbol = Symbol('senu.clone');

export interface CloneContext {
  clone<U>(value: U): U;
  register<D extends object>(source: object, destination: D): D;
}

export interface Cloneable {
  [CLONE_SYMBOL](context: CloneContext): object;
}

export interface CloneOptions extends TraversalOptions {
  readonly unsupported?: 'throw' | 'reference';
}

class Cloner {
  readonly #seen = new Map<object, object>();
  readonly #budget: Budget;
  readonly #shareUnsupported: boolean;

  constructor(options: CloneOptions | undefined) {
    this.#budget = createBudget(options);
    const mode = options?.unsupported ?? 'throw';
    if (mode !== 'throw' && mode !== 'reference') {
      throw new StateError('UNSUPPORTED_VALUE', 'unsupported must be "throw" or "reference"');
    }
    this.#shareUnsupported = mode === 'reference';
  }

  clone(value: unknown, depth: number): unknown {
    if (typeof value === 'symbol' || typeof value === 'function') return this.#unsupported(value, typeof value);
    if (typeof value !== 'object' || value === null) return value;
    const existing = this.#seen.get(value);
    if (existing !== undefined) return existing;
    if (depth > this.#budget.maxDepth || this.#budget.nodes >= this.#budget.maxNodes) {
      throw new StateError('TRAVERSAL_LIMIT', 'safeClone exceeded its traversal budget');
    }
    this.#budget.nodes++;

    const kind = kindOf(value);
    if (kind === 'other') return this.#custom(value, depth);
    if (!hasOnlyIntrinsicKeys(value, kind)) return this.#unsupported(value, 'built-in with custom properties');

    switch (kind) {
      case 'record':
      case 'array':
        return this.#properties(value, kind, depth);
      case 'date':
        return this.#register(value, new Date((value as Date).getTime()));
      case 'regexp': {
        const source = value as RegExp;
        const copy = this.#register(value, new RegExp(source.source, source.flags));
        copy.lastIndex = Object.getOwnPropertyDescriptor(source, 'lastIndex')!.value;
        return copy;
      }
      case 'map': {
        const copy = this.#register(value, new Map());
        for (const [key, item] of value as Map<unknown, unknown>) {
          copy.set(this.clone(key, depth + 1), this.clone(item, depth + 1));
        }
        return copy;
      }
      case 'set': {
        const copy = this.#register(value, new Set());
        for (const item of value as Set<unknown>) copy.add(this.clone(item, depth + 1));
        return copy;
      }
      case 'arraybuffer': {
        const source = value as ArrayBuffer & { resizable?: boolean; maxByteLength?: number };
        assertUsableBuffer(source);
        if (source.resizable === true) {
          const copy = new (ArrayBuffer as new (length: number, options: object) => ArrayBuffer)(source.byteLength, {
            maxByteLength: source.maxByteLength,
          });
          new Uint8Array(copy).set(new Uint8Array(source));
          return this.#register(value, copy);
        }
        return this.#register(value, source.slice(0));
      }
      case 'dataview': {
        const view = value as DataView;
        assertUsableBuffer(view.buffer);
        const buffer = this.clone(view.buffer, depth + 1) as ArrayBuffer;
        return this.#register(value, new DataView(buffer, view.byteOffset, view.byteLength));
      }
      case 'typedarray': {
        const view = value as TypedArray;
        assertUsableBuffer(view.buffer);
        const buffer = this.clone(view.buffer, depth + 1) as ArrayBuffer;
        const Ctor = typedArrayConstructors.get(Object.getPrototypeOf(view) as object)!;
        return this.#register(value, new Ctor(buffer, view.byteOffset, view.length));
      }
    }
  }

  #properties(value: object, kind: 'record' | 'array', depth: number): object {
    const keys = Reflect.ownKeys(value);
    const descriptors: [PropertyKey, PropertyDescriptor][] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) return this.#unsupported(value, 'object with accessor properties') as object;
      descriptors.push([key, descriptor]);
    }
    const copy: object = kind === 'array' ? [] : Object.create(Object.getPrototypeOf(value) as object | null);
    this.#register(value, copy);
    let lengthDescriptor: PropertyDescriptor | undefined;
    for (const [key, descriptor] of descriptors) {
      if (kind === 'array' && key === 'length') {
        lengthDescriptor = descriptor;
        (copy as unknown[]).length = descriptor.value as number;
        continue;
      }
      Object.defineProperty(copy, key, { ...descriptor, value: this.clone(descriptor.value, depth + 1) });
    }
    if (lengthDescriptor !== undefined && lengthDescriptor.writable === false) {
      Object.defineProperty(copy, 'length', { writable: false });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  #custom(value: object, depth: number): unknown {
    const hook = (value as Partial<Cloneable>)[CLONE_SYMBOL];
    if (typeof hook !== 'function') return this.#unsupported(value, 'object without a clone hook');
    const context: CloneContext = {
      clone: <U>(child: U): U => this.clone(child, depth + 1) as U,
      register: <D extends object>(source: object, destination: D): D => this.#register(source, destination),
    };
    const result = hook.call(value, context);
    if (typeof result !== 'object' || result === null) {
      throw new StateError('UNSUPPORTED_VALUE', 'Clone hooks must return an object');
    }
    return this.#register(value, result);
  }

  #register<D extends object>(source: object, destination: D): D {
    const existing = this.#seen.get(source);
    if (existing !== undefined && existing !== destination) {
      throw new StateError('UNSUPPORTED_VALUE', 'Conflicting clone destinations were registered');
    }
    this.#seen.set(source, destination);
    return destination;
  }

  #unsupported(value: unknown, description: string): unknown {
    if (!this.#shareUnsupported) throw new StateError('UNSUPPORTED_VALUE', `safeClone does not support ${description}`);
    if (typeof value === 'object' && value !== null) this.#seen.set(value, value);
    return value;
  }
}

/**
 * Deep-clones supported graphs, preserving cycles, aliases, holes, symbol keys, and descriptors.
 * Unsupported values throw `StateError` unless `unsupported: 'reference'` is set.
 */
export function safeClone<T>(value: T, options?: CloneOptions): T {
  assertOptionsObject('options', options);
  return new Cloner(options).clone(value, 1) as T;
}
