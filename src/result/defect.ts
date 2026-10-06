export class DefectError extends Error {
  override name = 'DefectError';

  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function isDefect(value: unknown): value is DefectError {
  return value instanceof DefectError;
}
