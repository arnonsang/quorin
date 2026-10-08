export class SecurityError extends Error {
  override name = 'SecurityError';
  readonly code: 'UNSAFE_PATH' = 'UNSAFE_PATH';

  constructor(message: string) {
    super(message);
  }
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export function assertSafeKey(key: string): void {
  if (FORBIDDEN.has(key)) throw new SecurityError(`Property name "${key}" is not allowed`);
}
