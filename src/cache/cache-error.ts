export type CacheErrorCode = 'CACHE_BUSY' | 'CACHE_INVALIDATED' | 'CACHE_LOAD_TIMEOUT';

export class CacheError extends Error {
  override name = 'CacheError';
  readonly code: CacheErrorCode;

  constructor(code: CacheErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
