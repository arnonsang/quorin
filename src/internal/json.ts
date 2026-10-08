import { type Budget, enter } from './budget.ts';
import { unsupportedValue } from './errors.ts';

export type JsonPrimitive = null | boolean | number | string;
export type JsonArray = readonly JsonValue[];
export type JsonRecord = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonRecord;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

export interface JsonVisitor {
  onRecordKey?(key: string): void;
}

export function forEachJsonEntry(
  value: object,
  callback: (key: string | number, child: unknown) => void,
  visitor?: JsonVisitor,
): void {
  if (Array.isArray(value)) {
    if (!isPlainArray(value)) throw unsupportedValue('Arrays must use the Array prototype');
    const length = value.length;
    if (Reflect.ownKeys(value).length !== length + 1) {
      throw unsupportedValue('Arrays must be dense and have no extra properties');
    }
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw unsupportedValue('Arrays must be dense and contain only data properties');
      }
      callback(index, descriptor.value);
    }
    return;
  }
  if (!isPlainRecord(value)) throw unsupportedValue('Only plain records and arrays are JSON values');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw unsupportedValue('Symbol keys are not JSON values');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if (!descriptor.enumerable) throw unsupportedValue('Non-enumerable properties are not JSON values');
    if (!('value' in descriptor)) throw unsupportedValue('Accessor properties are not JSON values');
    visitor?.onRecordKey?.(key);
    callback(key, descriptor.value);
  }
}

export function assertJsonScalar(value: unknown): void {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) throw unsupportedValue('Non-finite numbers are not JSON values');
      return;
    case 'object':
      if (value === null) return;
      break;
  }
  throw unsupportedValue(`Values of type ${typeof value} are not JSON values`);
}

export function writeCanonicalJson(value: unknown, budget: Budget, visitor?: JsonVisitor): string {
  const ancestors = new Set<object>();
  const write = (current: unknown, depth: number): string => {
    if (typeof current !== 'object' || current === null) {
      assertJsonScalar(current);
      if (typeof current === 'number') return Object.is(current, -0) ? '0' : JSON.stringify(current);
      return JSON.stringify(current);
    }
    if (ancestors.has(current)) throw unsupportedValue('Cyclic values are not JSON values');
    enter(budget, depth);
    ancestors.add(current);
    let output: string;
    if (Array.isArray(current)) {
      const parts: string[] = [];
      forEachJsonEntry(current, (_key, child) => parts.push(write(child, depth + 1)), visitor);
      output = `[${parts.join(',')}]`;
    } else {
      const entries: [string, unknown][] = [];
      forEachJsonEntry(current, (key, child) => entries.push([key as string, child]), visitor);
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      output = `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${write(child, depth + 1)}`).join(',')}}`;
    }
    ancestors.delete(current);
    return output;
  };
  return write(value, 1);
}
