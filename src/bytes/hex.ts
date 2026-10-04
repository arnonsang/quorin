import { invalidArgument, invalidEncoding } from '../internal/errors.ts';
import { assertBytes } from './assert.ts';

const HEX = '0123456789abcdef';
let table: string[] | undefined;

function hexTable(): string[] {
  if (table === undefined) {
    table = [];
    for (let byte = 0; byte < 256; byte++) table.push(HEX[byte >> 4]! + HEX[byte & 15]!);
  }
  return table;
}

function nibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

export function toHex(bytes: Uint8Array): string {
  assertBytes('bytes', bytes);
  const digits = hexTable();
  let output = '';
  for (let index = 0; index < bytes.byteLength; index++) output += digits[bytes[index]!];
  return output;
}

export function fromHex(text: string): Uint8Array {
  if (typeof text !== 'string') throw invalidArgument('text must be a string');
  if (text.length % 2 !== 0) throw invalidEncoding('Hex input must have an even length');
  for (let index = 0; index < text.length; index++) {
    if (nibble(text.charCodeAt(index)) < 0) throw invalidEncoding('Hex input contains a non-hex character');
  }
  const output = new Uint8Array(text.length / 2);
  for (let index = 0; index < output.length; index++) {
    output[index] = (nibble(text.charCodeAt(index * 2)) << 4) | nibble(text.charCodeAt(index * 2 + 1));
  }
  return output;
}
