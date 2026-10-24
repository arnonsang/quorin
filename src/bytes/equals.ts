import { assertBytes } from './assert.ts';

/**
 * Compares two byte views by length and content.
 * Exits at the first difference, so it is not a constant-time comparison.
 */
export function equalsBytes(a: Uint8Array, b: Uint8Array): boolean {
  assertBytes('a', a);
  assertBytes('b', b);
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
