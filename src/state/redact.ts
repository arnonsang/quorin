import { createBudget, type Budget, type TraversalOptions } from '../internal/budget.ts';
import type { JsonValue } from '../internal/json.ts';
import { invalidArgument } from '../internal/errors.ts';
import { assertFunction, assertOptionsObject } from '../internal/validate.ts';
import { kindOf } from './builtins.ts';

export type RedactPath = readonly (string | number)[];

export interface RedactOptions extends TraversalOptions {
  readonly keys?: readonly (string | RegExp)[];
  readonly defaultKeys?: boolean;
  readonly paths?: readonly RedactPath[];
  readonly mask?: string;
  readonly serializeError?: (error: Error) => JsonValue;
}

export const REDACTED = '[REDACTED]';
export const TRUNCATED = '[TRUNCATED]';

const DEFAULT_KEY_PATTERN = /passw(or)?d|secret|token|authorization|api[-_]?key|private[-_]?key|credential|cookie/i;

type Matcher = (key: string) => boolean;

function toMatcher(rule: string | RegExp): Matcher {
  if (typeof rule === 'string') {
    const lower = rule.toLowerCase();
    return (key) => key.toLowerCase() === lower;
  }
  if (!(rule instanceof RegExp)) throw invalidArgument('keys must contain strings or regular expressions');
  const pattern = new RegExp(rule.source, rule.flags.replace(/[gy]/g, ''));
  return (key) => pattern.test(key);
}

function knownMarker(value: object): string {
  const proto = Object.getPrototypeOf(value);
  if (proto === Promise.prototype) return '[PROMISE]';
  if (proto === WeakMap.prototype) return '[WEAKMAP]';
  if (proto === WeakSet.prototype) return '[WEAKSET]';
  if (typeof WeakRef === 'function' && proto === WeakRef.prototype) return '[WEAKREF]';
  return '[OBJECT]';
}

function errorName(error: Error): string {
  let current: object | null = error;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'name');
    if (descriptor !== undefined) return 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : 'Error';
    current = Object.getPrototypeOf(current) as object | null;
  }
  return 'Error';
}

function setOwn(target: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

class Redactor {
  readonly #matchers: Matcher[];
  readonly #paths: readonly RedactPath[];
  readonly #mask: string;
  readonly #serializeError: ((error: Error) => JsonValue) | undefined;
  readonly #budget: Budget;
  readonly #ancestors = new Set<object>();
  readonly #seen = new Set<object>();
  readonly #path: (string | number)[] = [];

  constructor(options: RedactOptions) {
    this.#budget = createBudget(options);
    const rules = options.keys ?? [];
    if (!Array.isArray(rules)) throw invalidArgument('keys must be an array');
    this.#matchers = rules.map(toMatcher);
    if (options.defaultKeys !== false) this.#matchers.push(toMatcher(DEFAULT_KEY_PATTERN));
    this.#paths = options.paths ?? [];
    if (!Array.isArray(this.#paths)) throw invalidArgument('paths must be an array of segment arrays');
    this.#mask = options.mask ?? REDACTED;
    if (typeof this.#mask !== 'string') throw invalidArgument('mask must be a string');
    if (options.serializeError !== undefined) assertFunction('serializeError', options.serializeError);
    this.#serializeError = options.serializeError;
  }

  #masked(key: string | number): boolean {
    if (typeof key === 'string' && this.#matchers.some((matches) => matches(key))) return true;
    return this.#paths.some(
      (rule) => rule.length === this.#path.length && rule.every((segment, index) => segment === this.#path[index]),
    );
  }

  #child(key: string | number, value: unknown, depth: number): JsonValue {
    this.#path.push(key);
    try {
      return this.#masked(key) ? this.#mask : this.project(value, depth + 1);
    } finally {
      this.#path.pop();
    }
  }

  project(value: unknown, depth: number): JsonValue {
    switch (typeof value) {
      case 'string':
      case 'boolean':
        return value;
      case 'number':
        return Number.isFinite(value) ? value : String(value);
      case 'bigint':
        return `${value}n`;
      case 'undefined':
        return null;
      case 'symbol':
        return '[SYMBOL]';
      case 'function':
        return '[FUNCTION]';
    }
    if (value === null) return null;
    const object = value as object;
    if (this.#ancestors.has(object)) return '[CIRCULAR]';
    if (this.#seen.has(object)) return '[REFERENCE]';
    if (depth > this.#budget.maxDepth || this.#budget.nodes >= this.#budget.maxNodes) return TRUNCATED;
    this.#budget.nodes++;
    this.#seen.add(object);
    this.#ancestors.add(object);
    try {
      return this.#projectObject(object, depth);
    } finally {
      this.#ancestors.delete(object);
    }
  }

  #projectObject(object: object, depth: number): JsonValue {
    if (object instanceof Error) {
      if (this.#serializeError !== undefined) return this.#serializeError(object);
      return { name: errorName(object), error: '[ERROR]' };
    }
    switch (kindOf(object)) {
      case 'array': {
        const output: JsonValue[] = [];
        const length = (object as unknown[]).length;
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(object, index);
          if (descriptor === undefined) output.push(null);
          else if (!('value' in descriptor)) output.push('[ACCESSOR]');
          else output.push(this.#child(index, descriptor.value, depth));
        }
        return output;
      }
      case 'record': {
        const output: Record<string, JsonValue> = {};
        for (const key of Reflect.ownKeys(object)) {
          const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
          if (!descriptor.enumerable) continue;
          if (typeof key === 'symbol') {
            setOwn(output, `[${String(key)}]`, '[SYMBOL KEY]');
          } else if (!('value' in descriptor)) {
            setOwn(output, key, this.#masked(key) ? this.#mask : '[ACCESSOR]');
          } else if (descriptor.value !== undefined) {
            setOwn(output, key, this.#child(key, descriptor.value, depth));
          }
        }
        return output;
      }
      case 'date': {
        const time = (object as Date).getTime();
        return Number.isNaN(time) ? '[INVALID DATE]' : (object as Date).toISOString();
      }
      case 'regexp':
        return `/${(object as RegExp).source}/${(object as RegExp).flags}`;
      case 'map': {
        const output: JsonValue[] = [];
        for (const [key, item] of object as Map<unknown, unknown>) {
          const projectedKey = this.project(key, depth + 1);
          const segment = typeof key === 'string' || typeof key === 'number' ? key : null;
          output.push([projectedKey, segment === null ? this.project(item, depth + 1) : this.#child(segment, item, depth)]);
        }
        return output;
      }
      case 'set': {
        const output: JsonValue[] = [];
        for (const item of object as Set<unknown>) output.push(this.project(item, depth + 1));
        return output;
      }
      case 'arraybuffer':
        return { type: 'ArrayBuffer', byteLength: (object as ArrayBuffer).byteLength };
      case 'dataview':
      case 'typedarray': {
        const view = object as ArrayBufferView;
        const name = Object.prototype.toString.call(view).slice(8, -1);
        return { type: name, byteLength: view.byteLength };
      }
      default:
        return knownMarker(object);
    }
  }
}

export function redact(value: unknown, options: RedactOptions = {}): JsonValue {
  assertOptionsObject('options', options);
  return new Redactor(options).project(value, 1);
}
