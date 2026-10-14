import { createBudget, type Budget, type TraversalOptions } from '../internal/budget.ts';
import { assertUsableBuffer, hasOnlyIntrinsicKeys, isSharedBuffer, kindOf, viewBytes, type Kind } from './builtins.ts';
import { StateError } from './state-error.ts';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index++) if (a[index] !== b[index]) return false;
  return true;
}

function sameDescriptorShape(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
  return (
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable &&
    a.writable === b.writable &&
    'value' in a === 'value' in b &&
    a.get === b.get &&
    a.set === b.set
  );
}

class Comparer {
  readonly #forward = new Map<object, object>();
  readonly #backward = new Map<object, object>();
  readonly #budget: Budget;

  constructor(options: TraversalOptions | undefined) {
    this.#budget = createBudget(options);
  }

  equal(a: unknown, b: unknown, depth: number): boolean {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return Object.is(a, b);
    const pairedA = this.#forward.get(a);
    const pairedB = this.#backward.get(b);
    if (pairedA !== undefined || pairedB !== undefined) return pairedA === b && pairedB === a;
    this.#forward.set(a, b);
    this.#backward.set(b, a);
    if (a === b) return true;

    if (depth > this.#budget.maxDepth || this.#budget.nodes >= this.#budget.maxNodes) {
      throw new StateError('TRAVERSAL_LIMIT', 'isEqual exceeded its traversal budget');
    }
    this.#budget.nodes++;

    const kind = this.#kind(a);
    if (kind !== this.#kind(b)) return false;
    if (kind === 'other') return false;

    switch (kind) {
      case 'record':
      case 'array':
        return this.#properties(a, b, depth);
      case 'date':
        return Object.is((a as Date).getTime(), (b as Date).getTime());
      case 'regexp': {
        const x = a as RegExp;
        const y = b as RegExp;
        return x.source === y.source && x.flags === y.flags && Object.is(x.lastIndex, y.lastIndex);
      }
      case 'map': {
        const x = a as Map<unknown, unknown>;
        const y = b as Map<unknown, unknown>;
        if (x.size !== y.size) return false;
        const other = y.entries();
        for (const [key, value] of x) {
          const next = other.next().value as [unknown, unknown];
          if (!this.equal(key, next[0], depth + 1) || !this.equal(value, next[1], depth + 1)) return false;
        }
        return true;
      }
      case 'set': {
        const x = a as Set<unknown>;
        const y = b as Set<unknown>;
        if (x.size !== y.size) return false;
        const other = y.values();
        for (const value of x) if (!this.equal(value, other.next().value, depth + 1)) return false;
        return true;
      }
      case 'arraybuffer':
        return sameBytes(new Uint8Array(a as ArrayBuffer), new Uint8Array(b as ArrayBuffer));
      case 'dataview':
      case 'typedarray': {
        const x = a as ArrayBufferView;
        const y = b as ArrayBufferView;
        return (
          Object.getPrototypeOf(x) === Object.getPrototypeOf(y) &&
          x.byteOffset === y.byteOffset &&
          sameBytes(viewBytes(x), viewBytes(y))
        );
      }
    }
  }

  #kind(value: object): Kind {
    const kind = kindOf(value);
    if (kind === 'other') {
      if (isSharedBuffer(value)) throw new StateError('UNSUPPORTED_VALUE', 'SharedArrayBuffer is not supported');
      return kind;
    }
    if (!hasOnlyIntrinsicKeys(value, kind)) {
      throw new StateError('UNSUPPORTED_VALUE', 'Built-in objects with custom properties are not supported');
    }
    if (kind === 'arraybuffer') assertUsableBuffer(value as ArrayBuffer);
    if (kind === 'dataview' || kind === 'typedarray') assertUsableBuffer((value as ArrayBufferView).buffer);
    return kind;
  }

  #properties(a: object, b: object, depth: number): boolean {
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    const keys = Reflect.ownKeys(a);
    if (keys.length !== Reflect.ownKeys(b).length) return false;
    for (const key of keys) {
      const x = Object.getOwnPropertyDescriptor(a, key)!;
      const y = Object.getOwnPropertyDescriptor(b, key);
      if (y === undefined || !sameDescriptorShape(x, y)) return false;
      if ('value' in x && !this.equal(x.value, y.value, depth + 1)) return false;
    }
    return true;
  }
}

export function isEqual(a: unknown, b: unknown, options?: TraversalOptions): boolean {
  return new Comparer(options).equal(a, b, 1);
}
