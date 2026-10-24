/** Marks a programming defect. Result adapters rethrow it instead of capturing it. */
export class DefectError extends Error {
  override name = 'DefectError';

  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Returns true for `DefectError` instances from this installed copy of senu. */
export function isDefect(value: unknown): value is DefectError {
  return value instanceof DefectError;
}
