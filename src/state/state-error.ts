export type StateErrorCode = 'UNSUPPORTED_VALUE' | 'TRAVERSAL_LIMIT';

export class StateError extends Error {
  override name = 'StateError';
  readonly code: StateErrorCode;

  constructor(code: StateErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
