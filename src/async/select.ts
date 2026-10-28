import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { getClock, schedule } from '../internal/clock.ts';
import { invalidArgument } from '../internal/errors.ts';
import { assertDuration, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import {
  closedError,
  coreOf,
  type ChannelCore,
  type ChannelReceiveResult,
  type ChannelReceiver,
  type ChannelSender,
} from './channel.ts';
import { QueueError } from './queue-error.ts';

/** An opaque case for `select`, created by `receive`, `send`, `after`, or `whenAborted`. `V` is the value it produces. */
export interface SelectCase<V> {
  readonly kind: 'receive' | 'send' | 'after' | 'aborted';
  readonly '~value'?: V;
}

type CaseSpec =
  | { readonly kind: 'receive'; readonly core: ChannelCore<unknown> }
  | { readonly kind: 'send'; readonly core: ChannelCore<unknown>; readonly value: unknown }
  | { readonly kind: 'after'; readonly ms: number }
  | { readonly kind: 'aborted'; readonly signal: AbortSignal };

const specs = new WeakMap<object, CaseSpec>();

function makeCase<V>(spec: CaseSpec): SelectCase<V> {
  const selectCase = Object.freeze({ kind: spec.kind }) as SelectCase<V>;
  specs.set(selectCase, spec);
  return selectCase;
}

/** A case that receives from `channel`, producing `{ ok: true, value }`, or `{ ok: false, closed: true }` once it is closed and drained. */
export function receive<T>(channel: ChannelReceiver<T>): SelectCase<ChannelReceiveResult<T>> {
  return makeCase({ kind: 'receive', core: coreOf(channel) });
}

/** A case that sends `value` on `channel`, producing `undefined`. Selecting it on a closed channel rejects `CHANNEL_CLOSED`. */
export function send<T>(channel: ChannelSender<T>, value: T): SelectCase<undefined> {
  return makeCase({ kind: 'send', core: coreOf(channel), value });
}

/** A case that becomes ready `ms` after the select starts parking, on the injected clock, producing `undefined`. */
export function after(ms: number): SelectCase<undefined> {
  assertDuration('ms', ms);
  return makeCase({ kind: 'after', ms });
}

/** A case that becomes ready when `signal` aborts, producing its reason. */
export function whenAborted(signal: AbortSignal): SelectCase<unknown> {
  if (signal === undefined) throw invalidArgument('signal must be an AbortSignal');
  assertOptionalSignal('signal', signal);
  return makeCase({ kind: 'aborted', signal });
}

export interface SelectOptions {
  readonly signal?: AbortSignal;
}

type CaseValue<C> = C extends SelectCase<infer V> ? V : never;
type CaseIndex<K> = K extends `${infer N extends number}` ? N : number;

/** The resolved `[value, index]` pair of a select over `C`, narrowable by `index`. */
export type SelectOutcome<C extends readonly SelectCase<unknown>[]> = {
  [K in keyof C]: [CaseValue<C[K]>, CaseIndex<K>];
}[number];

function isReady(spec: CaseSpec): boolean {
  switch (spec.kind) {
    case 'receive':
      return spec.core.canReceive();
    case 'send':
      return spec.core.canSend();
    case 'after':
      return false;
    case 'aborted':
      return spec.signal.aborted;
  }
}

/**
 * Waits for the first of several channel operations, timers, or aborts, and performs exactly
 * one. Resolves `[value, index]` for the case that won. When several cases are ready at once,
 * one is chosen at random so no case starves. With a `default` option, resolves
 * `[default, -1]` instead of waiting when nothing is ready. Losing cases never consume a value,
 * and their timers and listeners are released. `signal` aborts the select itself.
 */
export function select<const C extends readonly SelectCase<unknown>[], D>(
  cases: C,
  options: SelectOptions & { readonly default: D },
): Promise<SelectOutcome<C> | [D, -1]>;
export function select<const C extends readonly SelectCase<unknown>[]>(cases: C, options?: SelectOptions): Promise<SelectOutcome<C>>;
export function select(
  cases: readonly SelectCase<unknown>[],
  options: SelectOptions & { readonly default?: unknown } = {},
): Promise<[unknown, number]> {
  let list: CaseSpec[];
  try {
    if (!Array.isArray(cases)) throw invalidArgument('cases must be an array of select cases');
    assertOptionsObject('options', options);
    assertOptionalSignal('signal', options.signal);
    list = cases.map((selectCase) => {
      const spec = typeof selectCase === 'object' && selectCase !== null ? specs.get(selectCase) : undefined;
      if (spec === undefined) throw invalidArgument('cases must be created by receive, send, after, or whenAborted');
      return spec;
    });
    if (list.length === 0 && !('default' in options)) throw invalidArgument('select needs a case or a default');
  } catch (error) {
    return Promise.reject(error);
  }
  const signal = options.signal;
  if (signal?.aborted === true) return Promise.reject(signal.reason);

  const ready: number[] = [];
  list.forEach((spec, index) => {
    if (isReady(spec)) ready.push(index);
  });
  if (ready.length > 0) {
    const index = ready[Math.min(ready.length - 1, Math.floor(getClock().random() * ready.length))]!;
    const spec = list[index]!;
    switch (spec.kind) {
      case 'receive':
        return Promise.resolve([spec.core.pollReceive(), index]);
      case 'send':
        if (spec.core.closed) return Promise.reject(closedError());
        spec.core.pollSend(spec.value);
        return Promise.resolve([undefined, index]);
      default:
        return Promise.resolve([(spec as { signal: AbortSignal }).signal.reason, index]);
    }
  }
  if ('default' in options) return Promise.resolve([options.default, -1]);

  for (const spec of list) {
    if (spec.kind === 'send' && spec.core.senders.size >= spec.core.maxPending) {
      return Promise.reject(new QueueError('QUEUE_FULL', 'Too many sends are waiting for capacity'));
    }
  }

  return new Promise<[unknown, number]>((resolve, reject) => {
    const releases: Unsubscribe[] = [];
    let done = false;
    const claim = (): boolean => {
      if (done) return false;
      done = true;
      for (const release of releases) release();
      return true;
    };
    const clock = getClock();
    list.forEach((spec, index) => {
      switch (spec.kind) {
        case 'receive': {
          const node = spec.core.receivers.push({
            claim,
            deliver: (value) => resolve([{ ok: true, value }, index]),
            close: () => resolve([{ ok: false, closed: true }, index]),
          });
          releases.push(() => spec.core.receivers.remove(node));
          break;
        }
        case 'send': {
          const node = spec.core.senders.push({
            value: spec.value,
            claim,
            delivered: () => resolve([undefined, index]),
            close: () => reject(closedError()),
          });
          releases.push(() => spec.core.senders.remove(node));
          break;
        }
        case 'after':
          releases.push(
            schedule(clock, spec.ms, () => {
              if (claim()) resolve([undefined, index]);
            }),
          );
          break;
        case 'aborted':
          releases.push(
            onAbort(spec.signal, (reason) => {
              if (claim()) resolve([reason, index]);
            }),
          );
          break;
      }
    });
    let stop: Unsubscribe = noop;
    stop = onAbort(signal, (reason) => {
      if (claim()) reject(reason);
    });
    releases.push(() => stop());
  });
}
