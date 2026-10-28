import { onAbort } from '../internal/abort.ts';
import { getClock, schedule, type Clock } from '../internal/clock.ts';
import { invalidRange } from '../internal/errors.ts';
import { assertDuration, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import type { RunOptions } from './types.ts';

function sleep(clock: Clock, ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stop = onAbort(signal, (reason) => {
      cancel();
      reject(reason);
    });
    const cancel = schedule(clock, ms, () => {
      stop();
      resolve();
    });
  });
}

/**
 * Yields tick numbers every `intervalMs` on the injected clock, counted from when `tick` is
 * called. Ticks never pile up: a consumer that falls behind receives the latest due tick next,
 * so the numbers skip the missed ones. The timer only runs while the consumer waits for the
 * next tick, and the signal ends the iteration by throwing its reason.
 */
export function tick(intervalMs: number, options: RunOptions = {}): AsyncGenerator<number, void, undefined> {
  assertDuration('intervalMs', intervalMs);
  if (intervalMs === 0) throw invalidRange('intervalMs must be positive');
  assertOptionsObject('options', options);
  assertOptionalSignal('signal', options.signal);
  const clock = getClock();
  const start = clock.now();
  const signal = options.signal;
  return (async function* ticks(): AsyncGenerator<number, void, undefined> {
    let last = 0;
    for (;;) {
      if (signal?.aborted === true) throw signal.reason;
      const now = clock.now();
      const due = Math.floor((now - start) / intervalMs);
      if (due > last) {
        last = due;
      } else {
        await sleep(clock, start + (last + 1) * intervalMs - now, signal);
        last++;
      }
      yield last;
    }
  })();
}
