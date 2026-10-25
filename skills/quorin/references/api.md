# quorin API reference (0.1.x)

Compact signatures, options, and defaults for every export. Types are simplified for reading; the `.d.ts` files are authoritative.

## Contents

- [struct](#struct): Deque, ValueMap, Multimap
- [object](#object): getPath, setPath, deepMerge, stableStringify, SecurityError
- [bytes](#bytes): concatBytes, equalsBytes, stringToBytes, bytesToString, toHex, fromHex, toBase64, fromBase64, fastHash
- [async](#async): concurrencyLimit, mapAsync, QueueError
- [result](#result): ok, err, trySafe, trySafeSync, isDefect, DefectError
- [boundary](#boundary): parseEnv, defineBoundary, formatIssues, BoundaryValidationError
- [resilience](#resilience): withResilience, isUserAbort
- [cache](#cache): createCache, CacheError
- [state](#state): safeClone, isEqual, redact, CLONE_SYMBOL, REDACTED, TRUNCATED, StateError
- [Error codes](#error-codes)

## struct

```ts
class Deque<T> implements Iterable<T> {
  constructor(initialCapacity?: number);      // default 16, rounded up to a power of two, min 8, max 2^30
  readonly size: number;
  push(value: T): number;                     // returns new size
  unshift(value: T): number;
  pop(): T | undefined;                       // undefined when empty; check size if you store undefined
  shift(): T | undefined;
  peek(): T | undefined;                      // front
  peekBack(): T | undefined;                  // back
  clear(): void;                              // resets to the initial capacity
}
```

Mutating during iteration throws code `CONCURRENT_MODIFICATION`.

```ts
class ValueMap<K extends JsonValue, V> implements Iterable<[K, V]> {
  readonly size: number;
  set(key: K, value: V): this;                // key is canonicalized and snapshotted
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  entries(): IterableIterator<[K, V]>;        // keys are fresh copies, insertion order
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
}
```

Record key order is ignored, array order matters, `-0` equals `0`. Non-JSON keys throw `UNSUPPORTED_VALUE`. Lookup cost grows with key size.

```ts
class Multimap<K, V> implements Iterable<[K, readonly V[]]> {
  readonly size: number;        // keys
  readonly valueCount: number;  // values
  add(key: K, value: V): this;  // duplicates kept in order
  get(key: K): readonly V[];    // fresh copy, [] when missing
  has(key: K): boolean;
  delete(key: K): boolean;      // removes the whole key
  clear(): void;
  keys(): IterableIterator<K>;
  entries(): IterableIterator<[K, readonly V[]]>;
}
```

## object

Paths: `readonly (string | number)[]` or a dotted string. Numbers address array indexes, strings address record keys. Dotted strings are split on `.` into string segments only (use `['a.b']` for a literal dot, `['list', 0]` for an index). `__proto__`, `constructor`, `prototype` throw `SecurityError` (code `UNSAFE_PATH`).

```ts
function getPath<T, P>(target: T, path: P): PathValue<T, P>;
function getPath<T, P, F>(target: T, path: P, fallback: F): PathValue<T, P> | F;
```
Own data properties only. Missing (including inherited) returns the fallback. A present `undefined` is returned as is. Accessors throw `UNSUPPORTED_VALUE`. Literal paths infer types up to 8 segments; dynamic paths give `unknown`.

```ts
function setPath<T extends object, P>(target: T, path: P, value: PathValue<T, P>): void;
```
Mutates a plain record or dense array. Creates missing branches (null-prototype records, arrays for numeric segments starting at 0). Appends at `length`, rejects holes. Will not replace primitive branches, traverse class instances, invoke setters, or write frozen data. Validates first, then performs one write. For literal paths the value type is checked; widen the path to `string[]` for dynamic writes.

```ts
function deepMerge<L extends JsonRecord, R extends JsonRecord>(left: L, right: R): DeepMerge<L, R>;
```
New graph, inputs untouched. Records merge recursively; arrays and primitives from `right` replace. `null` on the right replaces a record. Forbidden keys anywhere throw `SecurityError`.

```ts
function stableStringify(value: JsonValue, options?: { maxDepth?: number; maxNodes?: number }): string;
```
Sorted keys (UTF-16 code unit order), valid JSON, `-0` as `0`, cycles throw. Not RFC 8785.

## bytes

All inputs are `Uint8Array` (Node `Buffer` works). Outputs are new buffers. Shared and detached buffers throw `UNSUPPORTED_VALUE`. Malformed input throws `SyntaxError` code `INVALID_ENCODING`.

```ts
function concatBytes(...parts: readonly Uint8Array[]): Uint8Array;
function equalsBytes(a: Uint8Array, b: Uint8Array): boolean;  // not constant time
function stringToBytes(text: string): Uint8Array;               // UTF-8
function bytesToString(bytes: Uint8Array, options?: { fatal?: boolean; ignoreBOM?: boolean }): string; // fatal default true
function toHex(bytes: Uint8Array): string;                      // lowercase
function fromHex(text: string): Uint8Array;                     // strict, either case
function toBase64(bytes: Uint8Array, options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string;
function fromBase64(text: string, options?: { alphabet?: 'base64' | 'base64url'; padding?: 'required' | 'optional' | 'forbidden' }): Uint8Array; // padding default 'required'
function fastHash(bytes: Uint8Array): number;                   // FNV-1a 32-bit unsigned, not for security
```

Typical JWT segment: `fromBase64(segment, { alphabet: 'base64url', padding: 'optional' })`.

## async

```ts
function concurrencyLimit(concurrency: number, options?: { maxPending?: number }): Limiter; // maxPending default 1024

interface Limiter {
  <T>(task: (context: { signal: AbortSignal }) => T | PromiseLike<T>, options?: { signal?: AbortSignal }): Promise<T>;
  readonly activeCount: number;   // unsettled underlying tasks
  readonly pendingCount: number;
  clear(reason?: unknown): void;  // rejects queued tasks (default QueueError QUEUE_CLEARED)
}
```
FIFO. Full queue rejects `QueueError` code `QUEUE_FULL`. Queued abort: removed and rejected at once. Running abort: caller rejects at once, task signal aborts, slot held until the task settles.

```ts
function mapAsync<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number, context: { signal: AbortSignal }) => R | PromiseLike<R>,
  options?: { concurrency?: number; signal?: AbortSignal },   // concurrency default 4
): Promise<R[]>;
```
Input order preserved, input snapshotted, sparse arrays rejected. First failure or abort stops new starts, aborts running mappers, rejects with that error or reason.

## result

```ts
type SafeResult<T, E = unknown> = Success<T> | Failure<E>;
// Success<T>: readonly [null, T] & { ok: true; error: null; data: T; unwrapOr(f): T; mapData(fn): SafeResult<U, never> }
// Failure<E>: readonly [E, null] & { ok: false; error: E; data: null; unwrapOr(f): U; mapData(fn): SafeResult<never, E> }

function ok<T>(data: T): SafeResult<T, never>;
function err<E>(error: E): SafeResult<never, E>;

interface CaptureOptions {
  classifyDefect?: (raw: unknown) => boolean;
  onDefect?: (raw: unknown) => void;
  catchDefects?: boolean;            // true captures defects as failures
}
function trySafeSync<T>(fn: () => T, options?: CaptureOptions): SafeResult<T, unknown>;
function trySafeSync<T, E>(fn: () => T, options: CaptureOptions & { mapError: (raw: unknown) => E }): SafeResult<T, E>;
function trySafe<T>(fn: () => T | PromiseLike<T>, options?: CaptureOptions): Promise<SafeResult<T, unknown>>;
function trySafe<T, E>(fn: () => T | PromiseLike<T>, options: CaptureOptions & { mapError: (raw: unknown) => E }): Promise<SafeResult<T, E>>;

class DefectError extends Error {}
function isDefect(value: unknown): value is DefectError;
```
Results are frozen real arrays; `JSON.stringify` gives `[error, data]`. Payloads are not frozen. Rebuild results after transport.

## boundary

Any Standard Schema v1 validator (Zod 3.24+, Valibot 1, ArkType 2, ...).

```ts
function parseEnv<S extends StandardSchemaV1>(schema: S, source: Readonly<Record<string, string | undefined>>): Promise<InferOutput<S>>;
// rejects BoundaryValidationError on issues; validator throws propagate

function defineBoundary<S, R>(schema: S, handler: (input: InferOutput<S>) => R | PromiseLike<R>, options?: CaptureOptions): (input: unknown) => Promise<SafeResult<R, unknown>>;
function defineBoundary<S, R, E>(schema: S, handler: ..., options: CaptureOptions & { mapError: (raw: unknown) => E }): (input: unknown) => Promise<SafeResult<R, BoundaryValidationError | E>>;

class BoundaryValidationError extends Error {
  readonly code: 'VALIDATION_FAILED';
  readonly vendor: string;
  readonly issues: readonly StandardSchemaV1.Issue[];
}

function formatIssues(source: BoundaryValidationError | readonly StandardSchemaV1.Issue[]): readonly { path: readonly PropertyKey[]; messages: readonly string[] }[];
```
Without `mapError`, the failure type is `unknown`; check `result.error instanceof BoundaryValidationError` to separate invalid input from handler failures. Validator crashes reject instead of resolving.

## resilience

```ts
function withResilience<T>(task: (context: { signal: AbortSignal; attempt: number }) => T | PromiseLike<T>, options?: ResilienceOptions): Promise<SafeResult<T, RunFailure>>;

interface ResilienceOptions<E = unknown> extends CaptureOptions {
  signal?: AbortSignal;
  retries?: number;                 // default 0, additional attempts
  retrySafe?: boolean;              // required true when retries > 0
  shouldRetry?: (error: E, attempt: number) => boolean;   // required when retries > 0, must return boolean
  attemptTimeoutMs?: number;        // 0 expires before the task runs
  totalTimeoutMs?: number;          // covers attempts and backoff
  baseDelayMs?: number;             // default 100
  maxDelayMs?: number;              // default 5000; delay before retry j is uniform in [0, min(max, base * 2^j))
  mapError?: (raw: unknown) => E;
}

type RunFailure<E = unknown> =
  | { kind: 'task'; error: E; attempt: number }
  | { kind: 'timeout'; scope: 'attempt' | 'total'; attempt: number; timeoutMs: number }
  | { kind: 'aborted'; reason: unknown; attempt: number };

function isUserAbort(value: unknown): boolean;  // true for aborted failures (or results holding them) made by withResilience
```
Invalid options, defects, and hook errors reject. Timeouts are terminal. A retry whose delay would reach `totalTimeoutMs` is skipped and the last task failure returned.

## cache

```ts
function createCache<K, V>(options: { max: number; ttlMs?: number; swrMs?: number }): Cache<K, V>;
function createCache<K, V>(options: {
  max: number; ttlMs?: number; swrMs?: number;
  load: (key: K, context: { signal: AbortSignal }) => V | PromiseLike<V>;
  maxInFlight?: number;        // default 32, includes invalidated loaders still running
  loadTimeoutMs?: number;      // default 30000, Infinity allowed
  onBackgroundError?: (error: unknown, key: K) => void;
}): LoadingCache<K, V>;

interface Cache<K, V> {
  readonly size: number; readonly max: number;
  get(key: K): V | undefined;        // fresh only, touches LRU
  has(key: K): boolean;              // fresh only, no touch
  lookup(key: K): { state: 'fresh' | 'stale'; value: V } | { state: 'miss' };  // no touch
  set(key: K, value: V): this;       // invalidates in-flight load for key
  delete(key: K): boolean;
  clear(): void;
}
interface LoadingCache<K, V> extends Cache<K, V> {
  readonly inFlightCount: number;
  getOrFetch(key: K, options?: { signal?: AbortSignal; onBackgroundTask?: (task: Promise<void>) => void }): Promise<V>;
}
```
Defaults: `ttlMs` Infinity, `swrMs` 0. TTL starts at commit; reads do not extend it. Strict LRU, `size <= max`. `undefined` keys and values are fine. Errors: `CacheError` codes `CACHE_BUSY` (new miss beyond `maxInFlight`), `CACHE_INVALIDATED` (set, delete, clear, or eviction during a load), `CACHE_LOAD_TIMEOUT`. Failures are not cached.

## state

```ts
function safeClone<T>(value: T, options?: { unsupported?: 'throw' | 'reference'; maxDepth?: number; maxNodes?: number }): T;
const CLONE_SYMBOL: unique symbol;
interface CloneContext { clone<U>(value: U): U; register<D extends object>(source: object, destination: D): D }

function isEqual(a: unknown, b: unknown, options?: { maxDepth?: number; maxNodes?: number }): boolean;

function redact(value: unknown, options?: {
  keys?: readonly (string | RegExp)[];      // extra matchers
  defaultKeys?: boolean;                    // default true: password, secret, token, authorization, api key, private key, credential, cookie
  paths?: readonly (readonly (string | number)[])[];
  mask?: string;                            // default REDACTED = '[REDACTED]'
  serializeError?: (error: Error) => JsonValue;
  maxDepth?: number; maxNodes?: number;     // beyond limits: TRUNCATED = '[TRUNCATED]'
}): JsonValue;

class StateError extends Error { readonly code: 'UNSUPPORTED_VALUE' | 'TRAVERSAL_LIMIT' }
```
`safeClone` supports primitives, plain records, arrays, Date, RegExp, Map, Set, ArrayBuffer, DataView, typed arrays; preserves cycles, aliases, holes, symbol keys, descriptors. Classes need a `[CLONE_SYMBOL](context)` method. `isEqual` compares Map/Set in insertion order and treats alias topology as significant; class instances compare by reference. `redact` markers: `[CIRCULAR]`, `[REFERENCE]`, `[FUNCTION]`, `[SYMBOL]`, `[ACCESSOR]`, `[OBJECT]`, `[ERROR]`, `[INVALID DATE]`, `[WEAKMAP]`, `[WEAKSET]`, `[WEAKREF]`, `[PROMISE]`; errors become `{ name, error: '[ERROR]' }`; buffers become `{ type, byteLength }`; bigint `'10n'`.

Default traversal limits everywhere: `maxDepth` 128, `maxNodes` 100000.

## Error codes

| Code | Class | Thrown by |
| --- | --- | --- |
| `INVALID_ARGUMENT` | TypeError or RangeError | any invalid option or argument |
| `UNSUPPORTED_VALUE` | TypeError or StateError | values outside a function's domain |
| `TRAVERSAL_LIMIT` | RangeError or StateError | depth or node budget exceeded |
| `UNSAFE_PATH` | SecurityError | forbidden path segment or key |
| `INVALID_ENCODING` | SyntaxError | hex, base64, UTF-8 decoding |
| `CAPACITY_EXCEEDED` | RangeError | Deque or concatBytes size limit |
| `CONCURRENT_MODIFICATION` | Error | Deque mutated while iterating |
| `VALIDATION_FAILED` | BoundaryValidationError | parseEnv, defineBoundary |
| `QUEUE_FULL`, `QUEUE_CLEARED` | QueueError | concurrencyLimit |
| `CACHE_BUSY`, `CACHE_INVALIDATED`, `CACHE_LOAD_TIMEOUT` | CacheError | loading caches |

Check with `(error as { code?: unknown }).code === 'QUEUE_FULL'` or `error instanceof QueueError && error.code === 'QUEUE_FULL'`.
