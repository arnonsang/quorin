import { invalidArgument } from '../internal/errors.ts';
import { assertSafeKey } from './security-error.ts';
import type { PathInput, PathSegment } from './types.ts';

export function normalizePath(path: PathInput): readonly PathSegment[] {
  const segments: readonly unknown[] = typeof path === 'string' ? path.split('.') : path;
  if (!Array.isArray(segments)) throw invalidArgument('path must be a string or an array of segments');
  for (const segment of segments) {
    if (typeof segment === 'string') {
      if (segment === '') throw invalidArgument('path segments must not be empty');
      assertSafeKey(segment);
    } else if (typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0) {
      throw invalidArgument('numeric path segments must be nonnegative safe integers');
    }
  }
  return segments as readonly PathSegment[];
}
