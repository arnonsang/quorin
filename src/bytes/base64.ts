import { invalidArgument, invalidEncoding } from '../internal/errors.ts';
import { assertOptionsObject } from '../internal/validate.ts';
import { assertBytes } from './assert.ts';

export type Base64Alphabet = 'base64' | 'base64url';

export interface ToBase64Options {
  readonly alphabet?: Base64Alphabet;
  readonly omitPadding?: boolean;
}

export interface FromBase64Options {
  readonly alphabet?: Base64Alphabet;
  readonly padding?: 'required' | 'optional' | 'forbidden';
}

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const reverse = new Map<Base64Alphabet, Int16Array>();

function chars(alphabet: Base64Alphabet | undefined): string {
  if (alphabet === undefined || alphabet === 'base64') return STANDARD;
  if (alphabet === 'base64url') return URL_SAFE;
  throw invalidArgument('alphabet must be "base64" or "base64url"');
}

function reverseTable(alphabet: Base64Alphabet): Int16Array {
  let lookup = reverse.get(alphabet);
  if (lookup === undefined) {
    lookup = new Int16Array(128).fill(-1);
    const source = chars(alphabet);
    for (let index = 0; index < 64; index++) lookup[source.charCodeAt(index)] = index;
    reverse.set(alphabet, lookup);
  }
  return lookup;
}

export function toBase64(bytes: Uint8Array, options: ToBase64Options = {}): string {
  assertBytes('bytes', bytes);
  assertOptionsObject('options', options);
  const source = chars(options.alphabet);
  const pad = options.omitPadding !== true;
  let output = '';
  const length = bytes.byteLength;
  let index = 0;
  for (; index + 2 < length; index += 3) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    output += source[n >> 18]! + source[(n >> 12) & 63]! + source[(n >> 6) & 63]! + source[n & 63]!;
  }
  const rest = length - index;
  if (rest === 1) {
    const n = bytes[index]! << 16;
    output += source[n >> 18]! + source[(n >> 12) & 63]! + (pad ? '==' : '');
  } else if (rest === 2) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
    output += source[n >> 18]! + source[(n >> 12) & 63]! + source[(n >> 6) & 63]! + (pad ? '=' : '');
  }
  return output;
}

export function fromBase64(text: string, options: FromBase64Options = {}): Uint8Array {
  if (typeof text !== 'string') throw invalidArgument('text must be a string');
  assertOptionsObject('options', options);
  const alphabet = options.alphabet ?? 'base64';
  chars(alphabet);
  const padding = options.padding ?? 'required';
  if (padding !== 'required' && padding !== 'optional' && padding !== 'forbidden') {
    throw invalidArgument('padding must be "required", "optional", or "forbidden"');
  }
  const lookup = reverseTable(alphabet);

  let end = text.length;
  let padCount = 0;
  while (end > 0 && text.charCodeAt(end - 1) === 61 && padCount < 2) {
    end--;
    padCount++;
  }
  if (padCount > 0) {
    if (padding === 'forbidden') throw invalidEncoding('Base64 padding is not allowed');
    if (text.length % 4 !== 0) throw invalidEncoding('Base64 input has malformed padding');
  } else if (end % 4 !== 0 && padding === 'required') {
    throw invalidEncoding('Base64 input is missing padding');
  }
  const remainder = end % 4;
  if (remainder === 1) throw invalidEncoding('Base64 input has an impossible length');
  if (padCount > 0 && remainder + padCount !== 4) throw invalidEncoding('Base64 input has malformed padding');

  for (let index = 0; index < end; index++) {
    const code = text.charCodeAt(index);
    if (code >= 128 || lookup[code]! < 0) throw invalidEncoding('Base64 input contains an invalid character');
  }
  const value = (index: number): number => lookup[text.charCodeAt(index)]!;
  if (remainder === 2 && (value(end - 1) & 15) !== 0) throw invalidEncoding('Base64 input has nonzero pad bits');
  if (remainder === 3 && (value(end - 1) & 3) !== 0) throw invalidEncoding('Base64 input has nonzero pad bits');

  const output = new Uint8Array(Math.floor(end / 4) * 3 + (remainder === 0 ? 0 : remainder - 1));
  let out = 0;
  let index = 0;
  for (; index + 3 < end; index += 4) {
    const n = (value(index) << 18) | (value(index + 1) << 12) | (value(index + 2) << 6) | value(index + 3);
    output[out++] = n >> 16;
    output[out++] = (n >> 8) & 255;
    output[out++] = n & 255;
  }
  if (remainder === 2) {
    output[out] = (value(index) << 2) | (value(index + 1) >> 4);
  } else if (remainder === 3) {
    const n = (value(index) << 10) | (value(index + 1) << 4) | (value(index + 2) >> 2);
    output[out++] = n >> 8;
    output[out] = n & 255;
  }
  return output;
}
