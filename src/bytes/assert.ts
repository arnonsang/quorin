import { invalidArgument, unsupportedValue } from '../internal/errors.ts';

export function assertBytes(name: string, value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw invalidArgument(`${name} must be a Uint8Array`);
  const buffer = value.buffer as ArrayBufferLike & { detached?: boolean };
  if (typeof SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer) {
    throw unsupportedValue(`${name} must not be backed by a SharedArrayBuffer`);
  }
  if (buffer.detached === true) throw unsupportedValue(`${name} must not use a detached buffer`);
}
