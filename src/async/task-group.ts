import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { invalidArgument } from '../internal/errors.ts';
import { LinkedQueue } from '../internal/linked-queue.ts';
import { assertFunction, assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { isDefect } from '../result/defect.ts';
import { err, ok, type SafeResult } from '../result/result.ts';
import type { TaskContext } from './types.ts';

export interface TaskGroupOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** A group of related tasks returned by `createTaskGroup`. */
export interface TaskGroup<T> {
  /** Starts `task`, or queues it while `concurrency` tasks run. Ignored once the group is stopping; throws after `wait` has settled. */
  run(task: (context: TaskContext) => T | PromiseLike<T>): void;
  /** Settles once every started task has settled: `ok` with values in `run` order, or `err` with the first failure. Defects reject. */
  wait(): Promise<SafeResult<T[], unknown>>;
  /** Stops the group: queued tasks are dropped and running tasks see their signal abort. */
  cancel(reason?: unknown): void;
  readonly signal: AbortSignal;
  readonly activeCount: number;
  readonly pendingCount: number;
}

interface Queued<T> {
  readonly task: (context: TaskContext) => T | PromiseLike<T>;
  readonly index: number;
}

/**
 * Creates a group that runs related tasks under one shared signal. The first failure, a
 * `cancel`, or an abort of the parent `signal` stops the group: queued tasks are dropped and
 * running tasks see the group signal abort with that reason. `wait` still waits for every
 * started task to settle, so no work outlives the group unobserved.
 */
export function createTaskGroup<T = unknown>(options: TaskGroupOptions = {}): TaskGroup<T> {
  assertOptionsObject('options', options);
  assertOptionalSignal('signal', options.signal);
  const concurrency = options.concurrency ?? Number.MAX_SAFE_INTEGER;
  assertInteger('concurrency', concurrency, 1);

  const controller = new AbortController();
  const queue = new LinkedQueue<Queued<T>>();
  const results: T[] = [];
  let nextIndex = 0;
  let active = 0;
  let failure: { readonly error: unknown } | undefined;
  let waitPromise: Promise<SafeResult<T[], unknown>> | undefined;
  let settleWait: (() => void) | undefined;
  let finished = false;
  let stopParent: Unsubscribe = noop;

  const fail = (error: unknown): void => {
    if (failure !== undefined) return;
    failure = { error };
    queue.drain();
    if (!controller.signal.aborted) controller.abort(error);
  };

  const checkDone = (): void => {
    if (settleWait !== undefined && active === 0 && queue.size === 0) settleWait();
  };

  const start = (entry: Queued<T>): void => {
    active++;
    new Promise<T>((resolve) => resolve(entry.task({ signal: controller.signal })))
      .then(
        (value) => {
          if (failure === undefined) results[entry.index] = value;
        },
        fail,
      )
      .then(() => {
        active--;
        while (failure === undefined && active < concurrency && queue.size > 0) start(queue.shift()!);
        checkDone();
      });
  };

  if (options.signal?.aborted === true) fail(options.signal.reason);
  else stopParent = onAbort(options.signal, fail);

  return {
    run(task: (context: TaskContext) => T | PromiseLike<T>): void {
      if (finished) throw invalidArgument('The task group has already finished');
      assertFunction('task', task);
      if (failure !== undefined) return;
      const entry = { task, index: nextIndex++ };
      if (active < concurrency) start(entry);
      else queue.push(entry);
    },

    wait(): Promise<SafeResult<T[], unknown>> {
      waitPromise ??= new Promise<SafeResult<T[], unknown>>((resolve, reject) => {
        settleWait = () => {
          settleWait = undefined;
          finished = true;
          stopParent();
          if (failure === undefined) resolve(ok(results));
          else if (isDefect(failure.error)) reject(failure.error);
          else resolve(err(failure.error));
        };
      });
      checkDone();
      return waitPromise;
    },

    cancel(reason?: unknown): void {
      if (failure !== undefined) return;
      controller.abort(reason);
      fail(controller.signal.reason);
    },

    get signal(): AbortSignal {
      return controller.signal;
    },
    get activeCount(): number {
      return active;
    },
    get pendingCount(): number {
      return queue.size;
    },
  };
}
