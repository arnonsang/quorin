import { invalidArgument, unsupportedValue } from '../internal/errors.ts';
import { isPlainArray, isPlainRecord } from '../internal/json.ts';
import { normalizePath } from './path.ts';
import type { IsLiteralPath, PathSegment, PathValue, ResolvePath } from './types.ts';

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return isPlainRecord(value) || isPlainArray(value);
}

function checkSlot(container: Container, segment: PathSegment): { exists: boolean; value: unknown } {
  if (Array.isArray(container)) {
    if (typeof segment !== 'number') throw invalidArgument('String segments cannot address array elements');
    if (segment > container.length) throw invalidArgument('setPath cannot create sparse arrays');
  } else if (typeof segment === 'number') {
    throw invalidArgument('Numeric segments can only address arrays');
  }
  const descriptor = Object.getOwnPropertyDescriptor(container, segment);
  if (descriptor === undefined) {
    if (!Object.isExtensible(container)) throw unsupportedValue('Cannot add a property to a non-extensible object');
    return { exists: false, value: undefined };
  }
  if (!('value' in descriptor)) throw unsupportedValue('setPath does not invoke accessor properties');
  return { exists: true, value: descriptor.value };
}

function define(container: Container, segment: PathSegment, value: unknown, exists: boolean): void {
  if (exists) Object.defineProperty(container, segment, { value });
  else Object.defineProperty(container, segment, { value, writable: true, enumerable: true, configurable: true });
}

function createBranch(segments: readonly PathSegment[], value: unknown): unknown {
  let child = value;
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]!;
    if (typeof segment === 'number') {
      if (segment !== 0) throw invalidArgument('setPath cannot create sparse arrays');
      child = [child];
    } else {
      const record: Record<string, unknown> = Object.create(null);
      define(record, segment, child, false);
      child = record;
    }
  }
  return child;
}

/**
 * Writes `value` at `path` in a plain record or dense array, creating missing branches.
 * The whole path is validated before the single write, so failures leave the input unchanged.
 */
export function setPath<T extends object, const P extends string | readonly PathSegment[]>(
  target: T,
  path: P,
  value: IsLiteralPath<P> extends true ? PathValue<T, ResolvePath<P>> : unknown,
): void;
export function setPath(target: object, path: string | readonly PathSegment[], value: unknown): void {
  const segments = normalizePath(path);
  if (segments.length === 0) throw invalidArgument('setPath requires a nonempty path');
  if (!isContainer(target)) throw unsupportedValue('setPath target must be a plain record or array');

  let container: Container = target;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const slot = checkSlot(container, segment);
    const last = index === segments.length - 1;
    if (last || !slot.exists || slot.value === undefined) {
      if (slot.exists) {
        const descriptor = Object.getOwnPropertyDescriptor(container, segment)!;
        if (descriptor.writable !== true) throw unsupportedValue('Cannot write a read-only property');
      }
      const written = last ? value : createBranch(segments.slice(index + 1), value);
      define(container, segment, written, slot.exists);
      return;
    }
    if (!isContainer(slot.value)) {
      if (typeof slot.value !== 'object' || slot.value === null) {
        throw unsupportedValue('setPath will not replace an existing primitive branch');
      }
      throw unsupportedValue('setPath only traverses plain records and arrays');
    }
    container = slot.value;
  }
}
