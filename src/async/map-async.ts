import { onAbort } from '../internal/abort.ts';
import { invalidArgument, unsupportedValue } from '../internal/errors.ts';
import { assertFunction, assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import type { TaskContext } from './types.ts';

export interface MapAsyncOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

export async function mapAsync<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number, context: TaskContext) => R | PromiseLike<R>,
  options: MapAsyncOptions = {},
): Promise<R[]> {
  if (!Array.isArray(items)) throw invalidArgument('items must be an array');
  assertFunction('mapper', mapper);
  assertOptionsObject('options', options);
  const concurrency = options.concurrency ?? 4;
  assertInteger('concurrency', concurrency, 1);
  const signal = options.signal;
  assertOptionalSignal('signal', signal);
  const snapshot: T[] = [];
  for (let index = 0; index < items.length; index++) {
    if (!Object.hasOwn(items, index)) throw unsupportedValue('mapAsync does not accept sparse arrays');
    snapshot.push(items[index]!);
  }
  if (signal?.aborted === true) throw signal.reason;
  if (snapshot.length === 0) return [];

  return new Promise<R[]>((resolve, reject) => {
    const results = new Array<R>(snapshot.length);
    const controller = new AbortController();
    let next = 0;
    let running = 0;
    let completed = 0;
    let stopped = false;

    const stop = (reason: unknown): void => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      controller.abort(reason);
      reject(reason);
    };
    const unsubscribe = onAbort(signal, stop);

    const launch = (): void => {
      while (!stopped && running < concurrency && next < snapshot.length) {
        const index = next++;
        running++;
        new Promise<R>((done) => done(mapper(snapshot[index]!, index, { signal: controller.signal }))).then(
          (value) => {
            running--;
            if (stopped) return;
            results[index] = value;
            completed++;
            if (completed === snapshot.length) {
              stopped = true;
              unsubscribe();
              resolve(results);
            } else {
              launch();
            }
          },
          (error: unknown) => {
            running--;
            stop(error);
          },
        );
      }
    };
    launch();
  });
}
