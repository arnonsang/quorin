export type SafeResult<T, E = unknown> = Success<T> | Failure<E>;

export type Success<T> = readonly [error: null, data: T] & {
  readonly ok: true;
  readonly error: null;
  readonly data: T;
  unwrapOr<U>(fallback: U): T;
  mapData<U>(fn: (value: T) => U): SafeResult<U, never>;
};

export type Failure<E> = readonly [error: E, data: null] & {
  readonly ok: false;
  readonly error: E;
  readonly data: null;
  unwrapOr<U>(fallback: U): U;
  mapData<U>(fn: (value: never) => U): SafeResult<never, E>;
};

type AnyResult = SafeResult<unknown, unknown>;

function unwrapOr(this: AnyResult, fallback: unknown): unknown {
  return this.ok ? this.data : fallback;
}

function mapData(this: AnyResult, fn: (value: unknown) => unknown): AnyResult {
  if (!this.ok) return this;
  return ok(fn(this.data));
}

function build(isOk: boolean, error: unknown, data: unknown): AnyResult {
  const tuple = [error, data];
  Object.defineProperties(tuple, {
    ok: { value: isOk },
    error: { value: error },
    data: { value: data },
    unwrapOr: { value: unwrapOr },
    mapData: { value: mapData },
  });
  return Object.freeze(tuple) as unknown as AnyResult;
}

export function ok<T>(data: T): SafeResult<T, never> {
  return build(true, null, data) as SafeResult<T, never>;
}

export function err<E>(error: E): SafeResult<never, E> {
  return build(false, error, null) as SafeResult<never, E>;
}
