import { invalidArgument, invalidEncoding } from '../internal/errors.ts';
import { assertBytes } from './assert.ts';

export interface DecodeOptions {
  readonly fatal?: boolean;
  readonly ignoreBOM?: boolean;
}

let encoder: TextEncoder | undefined;
const decoders = new Map<string, TextDecoder>();

export function stringToBytes(text: string): Uint8Array {
  if (typeof text !== 'string') throw invalidArgument('text must be a string');
  encoder ??= new TextEncoder();
  return encoder.encode(text);
}

export function bytesToString(bytes: Uint8Array, options: DecodeOptions = {}): string {
  assertBytes('bytes', bytes);
  const fatal = options.fatal ?? true;
  const ignoreBOM = options.ignoreBOM ?? false;
  const cacheKey = `${fatal}:${ignoreBOM}`;
  let decoder = decoders.get(cacheKey);
  if (decoder === undefined) {
    decoder = new TextDecoder('utf-8', { fatal, ignoreBOM });
    decoders.set(cacheKey, decoder);
  }
  try {
    return decoder.decode(bytes);
  } catch (cause) {
    const error = invalidEncoding('Input is not valid UTF-8');
    Object.defineProperty(error, 'cause', { value: cause, configurable: true, writable: true });
    throw error;
  }
}
