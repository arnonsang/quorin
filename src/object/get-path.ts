import { unsupportedValue } from '../internal/errors.ts';
import { normalizePath } from './path.ts';
import type { PathSegment, PathValue, SplitPath } from './types.ts';

const MISSING: unique symbol = Symbol('missing');

function readOwn(container: unknown, segment: PathSegment): unknown {
  if (typeof container !== 'object' || container === null) return MISSING;
  if (typeof segment === 'number') {
    if (!Array.isArray(container)) return MISSING;
  } else if (Array.isArray(container)) {
    return MISSING;
  }
  const descriptor = Object.getOwnPropertyDescriptor(container, segment);
  if (descriptor === undefined) return MISSING;
  if (!('value' in descriptor)) throw unsupportedValue('getPath does not invoke accessor properties');
  return descriptor.value;
}

export function getPath<T, const P extends readonly PathSegment[]>(target: T, path: P): PathValue<T, P>;
export function getPath<T, const P extends readonly PathSegment[], F>(target: T, path: P, fallback: F): PathValue<T, P> | F;
export function getPath<T, const P extends string>(target: T, path: P): PathValue<T, SplitPath<P>>;
export function getPath<T, const P extends string, F>(target: T, path: P, fallback: F): PathValue<T, SplitPath<P>> | F;
export function getPath(target: unknown, path: string | readonly PathSegment[], fallback?: unknown): unknown {
  let current = target;
  for (const segment of normalizePath(path)) {
    current = readOwn(current, segment);
    if (current === MISSING) return fallback;
  }
  return current;
}
