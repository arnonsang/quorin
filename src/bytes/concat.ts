import { capacityExceeded } from '../internal/errors.ts';
import { assertBytes } from './assert.ts';

/**
 * Concatenates byte views into one newly allocated `Uint8Array`.
 * Inputs are copied in order and never modified.
 */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    assertBytes(`parts[${index}]`, part);
    total += part.byteLength;
    if (!Number.isSafeInteger(total)) throw capacityExceeded('Combined length is too large');
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
