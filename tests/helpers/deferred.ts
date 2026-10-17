export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function flush(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export function settled<T>(promise: Promise<T>): { readonly state: 'pending' | 'fulfilled' | 'rejected'; readonly value?: T; readonly reason?: unknown } {
  const record: { state: 'pending' | 'fulfilled' | 'rejected'; value?: T; reason?: unknown } = { state: 'pending' };
  promise.then(
    (value) => {
      record.state = 'fulfilled';
      record.value = value;
    },
    (reason: unknown) => {
      record.state = 'rejected';
      record.reason = reason;
    },
  );
  return record;
}
