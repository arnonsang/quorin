import { StateError } from './state-error.ts';

export type Kind =
  | 'record'
  | 'array'
  | 'date'
  | 'regexp'
  | 'map'
  | 'set'
  | 'arraybuffer'
  | 'dataview'
  | 'typedarray'
  | 'other';

type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array
  | Float32Array | Float64Array | BigInt64Array | BigUint64Array;

export type TypedArrayConstructor = new (buffer: ArrayBuffer, offset: number, length: number) => TypedArray;

export const typedArrayConstructors: Map<object, TypedArrayConstructor> = new Map();
for (const name of [
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
]) {
  const ctor = (globalThis as Record<string, unknown>)[name];
  if (typeof ctor === 'function') typedArrayConstructors.set(ctor.prototype as object, ctor as TypedArrayConstructor);
}

const typedArrayTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!
  .get as (this: unknown) => string | undefined;
const getter = (proto: object, key: string) =>
  Object.getOwnPropertyDescriptor(proto, key)!.get as (this: unknown) => unknown;
const dateTime = Date.prototype.getTime;
const regexpSource = getter(RegExp.prototype, 'source');
const mapSize = getter(Map.prototype, 'size');
const setSize = getter(Set.prototype, 'size');
const bufferByteLength = getter(ArrayBuffer.prototype, 'byteLength');
const viewBuffer = getter(DataView.prototype, 'buffer');

function hasBrand(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

export function kindOf(value: object): Kind {
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) return proto === Array.prototype ? 'array' : 'other';
  if (proto === Object.prototype || proto === null) return 'record';
  if (proto === Date.prototype) return hasBrand(() => dateTime.call(value)) ? 'date' : 'other';
  if (proto === RegExp.prototype) return hasBrand(() => regexpSource.call(value)) ? 'regexp' : 'other';
  if (proto === Map.prototype) return hasBrand(() => mapSize.call(value)) ? 'map' : 'other';
  if (proto === Set.prototype) return hasBrand(() => setSize.call(value)) ? 'set' : 'other';
  if (proto === ArrayBuffer.prototype) return hasBrand(() => bufferByteLength.call(value)) ? 'arraybuffer' : 'other';
  if (proto === DataView.prototype) return hasBrand(() => viewBuffer.call(value)) ? 'dataview' : 'other';
  if (typedArrayConstructors.has(proto)) return typedArrayTag.call(value) !== undefined ? 'typedarray' : 'other';
  return 'other';
}

export function isSharedBuffer(value: object): boolean {
  return typeof SharedArrayBuffer === 'function' && Object.getPrototypeOf(value) === SharedArrayBuffer.prototype;
}

export function assertUsableBuffer(buffer: ArrayBufferLike): void {
  if (isSharedBuffer(buffer)) throw new StateError('UNSUPPORTED_VALUE', 'SharedArrayBuffer is not supported');
  if ((buffer as { detached?: boolean }).detached === true) {
    throw new StateError('UNSUPPORTED_VALUE', 'Detached buffers are not supported');
  }
}

export function hasOnlyIntrinsicKeys(value: object, kind: Kind): boolean {
  const keys = Reflect.ownKeys(value);
  switch (kind) {
    case 'regexp':
      return keys.length === 1 && keys[0] === 'lastIndex';
    case 'typedarray':
      return keys.length === (value as TypedArray).length;
    case 'date':
    case 'map':
    case 'set':
    case 'arraybuffer':
    case 'dataview':
      return keys.length === 0;
    default:
      return true;
  }
}

export function viewBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export type { TypedArray };
