export interface CacheOptions {
  readonly max: number;
  readonly ttlMs?: number;
  readonly swrMs?: number;
}

export interface LoadContext {
  readonly signal: AbortSignal;
}

export interface LoadingCacheOptions<K, V> extends CacheOptions {
  readonly load: (key: K, context: LoadContext) => V | PromiseLike<V>;
  readonly maxInFlight?: number;
  readonly loadTimeoutMs?: number;
  readonly onBackgroundError?: (error: unknown, key: K) => void;
}

export type CacheLookup<V> =
  | { readonly state: 'fresh'; readonly value: V }
  | { readonly state: 'stale'; readonly value: V }
  | { readonly state: 'miss' };

export interface GetOrFetchOptions {
  readonly signal?: AbortSignal;
  readonly onBackgroundTask?: (task: Promise<void>) => void;
}

export interface Cache<K, V> {
  readonly size: number;
  readonly max: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  lookup(key: K): CacheLookup<V>;
  set(key: K, value: V): this;
  delete(key: K): boolean;
  clear(): void;
}

export interface LoadingCache<K, V> extends Cache<K, V> {
  readonly inFlightCount: number;
  getOrFetch(key: K, options?: GetOrFetchOptions): Promise<V>;
}
