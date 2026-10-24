export type CacheErrorCode = 'CACHE_BUSY' | 'CACHE_INVALIDATED' | 'CACHE_LOAD_TIMEOUT';

/** Rejection reason for busy, invalidated, or timed-out cache loads. */
export class CacheError extends Error {
  override name = 'CacheError';
  readonly code: CacheErrorCode;

  constructor(code: CacheErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
