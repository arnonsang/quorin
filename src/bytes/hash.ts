import { assertBytes } from './assert.ts';

/**
 * Computes the 32-bit FNV-1a hash of the given bytes as an unsigned integer.
 * Not suitable for security or for defending hash tables against untrusted input.
 */
export function fastHash(bytes: Uint8Array): number {
  assertBytes('bytes', bytes);
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.byteLength; index++) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
