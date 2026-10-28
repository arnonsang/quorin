export type QuorinErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_VALUE'
  | 'TRAVERSAL_LIMIT'
  | 'UNSAFE_PATH'
  | 'CAPACITY_EXCEEDED'
  | 'CONCURRENT_MODIFICATION'
  | 'INVALID_ENCODING'
  | 'VALIDATION_FAILED'
  | 'QUEUE_FULL'
  | 'QUEUE_CLEARED'
  | 'CHANNEL_CLOSED'
  | 'CACHE_BUSY'
  | 'CACHE_INVALIDATED'
  | 'CACHE_LOAD_TIMEOUT';

export type CodedError<E extends Error, C extends QuorinErrorCode> = E & { readonly code: C };

function withCode<E extends Error, C extends QuorinErrorCode>(error: E, code: C): CodedError<E, C> {
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error as CodedError<E, C>;
}

export function invalidArgument(message: string): CodedError<TypeError, 'INVALID_ARGUMENT'> {
  return withCode(new TypeError(message), 'INVALID_ARGUMENT');
}

export function invalidRange(message: string): CodedError<RangeError, 'INVALID_ARGUMENT'> {
  return withCode(new RangeError(message), 'INVALID_ARGUMENT');
}

export function unsupportedValue(message: string): CodedError<TypeError, 'UNSUPPORTED_VALUE'> {
  return withCode(new TypeError(message), 'UNSUPPORTED_VALUE');
}

export function traversalLimit(message: string): CodedError<RangeError, 'TRAVERSAL_LIMIT'> {
  return withCode(new RangeError(message), 'TRAVERSAL_LIMIT');
}

export function capacityExceeded(message: string): CodedError<RangeError, 'CAPACITY_EXCEEDED'> {
  return withCode(new RangeError(message), 'CAPACITY_EXCEEDED');
}

export function concurrentModification(message: string): CodedError<Error, 'CONCURRENT_MODIFICATION'> {
  return withCode(new Error(message), 'CONCURRENT_MODIFICATION');
}

export function invalidEncoding(message: string): CodedError<SyntaxError, 'INVALID_ENCODING'> {
  return withCode(new SyntaxError(message), 'INVALID_ENCODING');
}
