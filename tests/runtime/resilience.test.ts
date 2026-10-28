import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isUserAbort, parseRetryAfter, withResilience, type RunFailure } from '../../src/resilience/index.ts';
import { DefectError } from '../../src/result/index.ts';
import { deferred, settled } from '../helpers/deferred.ts';
import { installFakeClock, type FakeClock } from '../helpers/fake-clock.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

function retryAfterOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('retryAfter' in error)) return undefined;
  return typeof error.retryAfter === 'string' ? error.retryAfter : undefined;
}

let clock: FakeClock;
let restore: () => void;

beforeEach(() => {
  ({ clock, restore } = installFakeClock());
});

afterEach(() => restore());

describe('withResilience', () => {
  it('returns a success result with a one-based attempt', async () => {
    const attempts: number[] = [];
    const result = await withResilience(({ attempt }) => {
      attempts.push(attempt);
      return 'value';
    });
    assert.equal(result.ok && result.data, 'value');
    assert.deepEqual(attempts, [1]);
  });

  it('returns task failures without retrying by default', async () => {
    const result = await withResilience(() => Promise.reject(new TypeError('network')));
    assert.equal(result.ok, false);
    const failure = result.error as RunFailure;
    assert.equal(failure.kind, 'task');
    assert.ok(failure.kind === 'task' && failure.error instanceof TypeError);
    assert.equal(failure.attempt, 1);
  });

  it('requires retrySafe and shouldRetry for retries', async () => {
    await assert.rejects(withResilience(() => 1, { retries: 1 }), code('INVALID_ARGUMENT'));
    await assert.rejects(withResilience(() => 1, { retries: 1, retrySafe: true }), code('INVALID_ARGUMENT'));
  });

  it('retries with full jitter backoff and a fresh invocation', async () => {
    const attempts: number[] = [];
    const delays: number[] = [];
    clock.randomValue = 0.5;
    const run = withResilience(({ attempt }) => {
      attempts.push(attempt);
      delays.push(clock.now());
      if (attempt < 3) throw new Error(`fail ${attempt}`);
      return attempt;
    }, { retries: 2, retrySafe: true, shouldRetry: () => true, baseDelayMs: 100, maxDelayMs: 150 });
    await clock.advance(1000);
    const result = await run;
    assert.equal(result.ok && result.data, 3);
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(delays, [0, 50, 125]);
  });

  it('stops when shouldRetry declines and passes mapped errors', async () => {
    const seen: [unknown, number][] = [];
    const result = await withResilience(() => {
      throw new Error('raw');
    }, {
      retries: 3,
      retrySafe: true,
      mapError: (raw) => (raw as Error).message,
      shouldRetry: (error, attempt) => {
        seen.push([error, attempt]);
        return false;
      },
    });
    assert.deepEqual(seen, [['raw', 1]]);
    assert.deepEqual(result.error, { kind: 'task', error: 'raw', attempt: 1 });
  });

  it('exhausts retries and reports the last attempt', async () => {
    const run = withResilience(() => Promise.reject('x'), { retries: 2, retrySafe: true, shouldRetry: () => true });
    await clock.advance(10_000);
    const result = await run;
    assert.deepEqual(result.error, { kind: 'task', error: 'x', attempt: 3 });
  });

  it('times out an attempt, aborts its signal, and does not retry', async () => {
    let taskSignal: AbortSignal | undefined;
    let calls = 0;
    const run = withResilience(({ signal }) => {
      calls++;
      taskSignal = signal;
      return new Promise(() => {});
    }, { attemptTimeoutMs: 100, retries: 3, retrySafe: true, shouldRetry: () => true });
    await clock.advance(100);
    const result = await run;
    assert.deepEqual(result.error, { kind: 'timeout', scope: 'attempt', attempt: 1, timeoutMs: 100 });
    assert.equal(taskSignal?.aborted, true);
    assert.equal((taskSignal?.reason as Error).name, 'TimeoutError');
    assert.equal(calls, 1);
    assert.equal(clock.pendingTimers, 0);
  });

  it('enforces a total deadline across backoff', async () => {
    const run = withResilience(() => Promise.reject('x'), {
      totalTimeoutMs: 250,
      retries: 10,
      retrySafe: true,
      shouldRetry: () => true,
      baseDelayMs: 100,
      maxDelayMs: 100,
    });
    clock.randomValue = 0.99;
    await clock.advance(1000);
    const result = await run;
    assert.equal((result.error as RunFailure).kind, 'task');
    assert.equal(clock.pendingTimers, 0);
  });

  it('times out the whole run while a task is pending', async () => {
    const run = withResilience(() => new Promise(() => {}), { totalTimeoutMs: 50 });
    await clock.advance(50);
    assert.deepEqual((await run).error, { kind: 'timeout', scope: 'total', attempt: 1, timeoutMs: 50 });
  });

  it('expires zero timeouts before invoking the task', async () => {
    let calls = 0;
    const task = () => {
      calls++;
      return 1;
    };
    assert.deepEqual((await withResilience(task, { totalTimeoutMs: 0 })).error, { kind: 'timeout', scope: 'total', attempt: 0, timeoutMs: 0 });
    assert.deepEqual((await withResilience(task, { attemptTimeoutMs: 0 })).error, { kind: 'timeout', scope: 'attempt', attempt: 1, timeoutMs: 0 });
    assert.equal(calls, 0);
  });

  it('reports caller aborts and recognizes them with isUserAbort', async () => {
    const controller = new AbortController();
    const gate = deferred();
    const run = withResilience(() => gate.promise, { signal: controller.signal });
    controller.abort('user');
    const result = await run;
    assert.deepEqual(result.error, { kind: 'aborted', reason: 'user', attempt: 1 });
    assert.equal(isUserAbort(result), true);
    assert.equal(isUserAbort(result.error), true);
    assert.equal(isUserAbort({ kind: 'aborted', reason: 'user', attempt: 1 }), false);
    assert.equal(isUserAbort(Object.assign(new Error('x'), { name: 'AbortError' })), false);
    assert.equal(isUserAbort(null), false);
    gate.resolve();
  });

  it('handles already aborted signals and aborts during backoff', async () => {
    let calls = 0;
    const pre = await withResilience(() => {
      calls++;
    }, { signal: AbortSignal.abort('early') });
    assert.deepEqual(pre.error, { kind: 'aborted', reason: 'early', attempt: 0 });
    assert.equal(calls, 0);
    const controller = new AbortController();
    const run = withResilience(() => Promise.reject('x'), { signal: controller.signal, retries: 1, retrySafe: true, shouldRetry: () => true });
    await clock.advance(1);
    controller.abort('during backoff');
    assert.deepEqual((await run).error, { kind: 'aborted', reason: 'during backoff', attempt: 1 });
    assert.equal(clock.pendingTimers, 0);
  });

  it('lets an observed success win and ignores late settlements', async () => {
    const gate = deferred<string>();
    const run = withResilience(() => gate.promise, { attemptTimeoutMs: 100 });
    const state = settled(run);
    gate.resolve('first');
    await clock.advance(200);
    assert.equal(state.state, 'fulfilled');
    assert.equal((await run).data, 'first');
  });

  it('rejects defects and hook failures', async () => {
    await assert.rejects(withResilience(() => {
      throw new DefectError('bug');
    }), DefectError);
    await assert.rejects(withResilience(() => Promise.reject('x'), {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => {
        throw new Error('hook');
      },
    }), /hook/);
    await assert.rejects(withResilience(() => Promise.reject('x'), {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => 'yes' as never,
    }), code('INVALID_ARGUMENT'));
  });

  it('validates configuration', async () => {
    await assert.rejects(withResilience('x' as never), code('INVALID_ARGUMENT'));
    await assert.rejects(withResilience(() => 1, { attemptTimeoutMs: -1 }), code('INVALID_ARGUMENT'));
    await assert.rejects(withResilience(() => 1, { totalTimeoutMs: NaN }), code('INVALID_ARGUMENT'));
    await assert.rejects(withResilience(() => 1, { baseDelayMs: 200, maxDelayMs: 100 }), code('INVALID_ARGUMENT'));
    await assert.rejects(withResilience(() => 1, { retries: 1.5 }), code('INVALID_ARGUMENT'));
  });
});

describe('retryDelayMs', () => {
  it('replaces the jittered curve with the caller delay', async () => {
    const times: number[] = [];
    const run = withResilience(({ attempt }) => {
      times.push(clock.now());
      if (attempt < 3) throw new Error('x');
      return attempt;
    }, {
      retries: 2,
      retrySafe: true,
      shouldRetry: () => true,
      baseDelayMs: 100,
      maxDelayMs: 150,
      retryDelayMs: ({ attempt }) => attempt * 100,
    });
    await clock.advance(1000);
    const result = await run;
    assert.equal(result.ok && result.data, 3);
    assert.deepEqual(times, [0, 100, 300]);
  });

  it('awaits an async hook and lets delays exceed maxDelayMs', async () => {
    const times: number[] = [];
    const run = withResilience(({ attempt }) => {
      times.push(clock.now());
      if (attempt < 2) throw new Error('x');
      return 'ok';
    }, {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => true,
      maxDelayMs: 100,
      retryDelayMs: async () => 250,
    });
    await clock.advance(1000);
    assert.deepEqual(await run.then((outcome) => outcome.data), 'ok');
    assert.deepEqual(times, [0, 250]);
  });

  it('passes the captured error and failing attempt to the hook', async () => {
    const seen: { error: unknown; attempt: number }[] = [];
    const run = withResilience(() => Promise.reject('x'), {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => true,
      mapError: (raw) => `mapped:${String(raw)}`,
      retryDelayMs: (failure) => {
        seen.push(failure);
        return 50;
      },
    });
    await clock.advance(100);
    await run;
    assert.deepEqual(seen, [{ error: 'mapped:x', attempt: 1 }]);
  });

  it('still applies the total timeout over caller delays', async () => {
    const run = withResilience(() => Promise.reject('x'), {
      retries: 3,
      retrySafe: true,
      shouldRetry: () => true,
      totalTimeoutMs: 200,
      retryDelayMs: () => 500,
    });
    await clock.advance(1000);
    assert.deepEqual((await run).error, { kind: 'task', error: 'x', attempt: 1 });
    assert.equal(clock.pendingTimers, 0);
  });

  it('rejects when the hook resolves to an invalid delay', async () => {
    for (const bad of [-1, NaN, Infinity, '100' as never, undefined as never, null as never]) {
      await assert.rejects(withResilience(() => Promise.reject('x'), {
        retries: 1,
        retrySafe: true,
        shouldRetry: () => true,
        retryDelayMs: () => bad,
      }), code('INVALID_ARGUMENT'), `delay ${String(bad)}`);
    }
  });

  it('rejects when the hook throws, rejects, or is not a function', async () => {
    await assert.rejects(withResilience(() => Promise.reject('x'), {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => true,
      retryDelayMs: () => {
        throw new Error('sync hook');
      },
    }), /sync hook/);
    await assert.rejects(withResilience(() => Promise.reject('x'), {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => true,
      retryDelayMs: () => Promise.reject(new Error('async hook')),
    }), /async hook/);
    await assert.rejects(withResilience(() => Promise.reject('x'), {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => true,
      retryDelayMs: 'x' as never,
    }), code('INVALID_ARGUMENT'));
  });

  it('schedules nothing when aborted while awaiting the hook', async () => {
    const controller = new AbortController();
    const gate = deferred<number>();
    let calls = 0;
    const run = withResilience(() => {
      calls++;
      return Promise.reject(new Error('x'));
    }, {
      retries: 1,
      retrySafe: true,
      shouldRetry: () => true,
      signal: controller.signal,
      retryDelayMs: () => gate.promise,
    });
    await settled(run);
    controller.abort('stop');
    assert.deepEqual((await run).error, { kind: 'aborted', reason: 'stop', attempt: 1 });
    gate.resolve(100);
    await clock.advance(1000);
    assert.equal(calls, 1);
    assert.equal(clock.pendingTimers, 0);
  });

  it('honors a Retry-After header end to end', async () => {
    clock.epochBase = Date.UTC(2026, 9, 28, 4, 0, 0);
    const times: number[] = [];
    const run = withResilience(({ attempt }) => {
      times.push(clock.now());
      if (attempt < 2) throw Object.assign(new Error('limited'), { retryAfter: 'Wed, 28 Oct 2026 04:00:30 GMT' });
      return 'done';
    }, {
      retries: 1,
      retrySafe: true,
      shouldRetry: (error) => retryAfterOf(error) !== undefined,
      retryDelayMs: ({ error }) => parseRetryAfter(retryAfterOf(error)) ?? 1000,
    });
    await clock.advance(60_000);
    assert.deepEqual(await run.then((outcome) => outcome.data), 'done');
    assert.deepEqual(times, [0, 30_000]);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta seconds', () => {
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter('120'), 120_000);
    assert.equal(parseRetryAfter('  007 '), 7_000);
    assert.equal(parseRetryAfter('9007199254740'), 9_007_199_254_740_000);
  });

  it('returns null for malformed values', () => {
    for (const bad of ['', '   ', null, undefined, '-5', '1.5', '1e3', '12s', '120 x', '99999999999999999', '١٢٣']) {
      assert.equal(parseRetryAfter(bad), null, JSON.stringify(bad));
    }
  });

  it('parses IMF-fixdate relative to the epoch clock', () => {
    clock.epochBase = Date.UTC(2026, 9, 28, 4, 0, 0);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 04:00:10 GMT'), 10_000);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 05:30:00 GMT'), 5_400_000);
    assert.equal(parseRetryAfter('Tue, 27 Oct 2026 23:59:59 GMT'), 0);
  });

  it('shrinks fixed dates as the clock advances', async () => {
    clock.epochBase = Date.UTC(2026, 9, 28, 4, 0, 0);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 04:01:00 GMT'), 60_000);
    await clock.advance(30_000);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 04:01:00 GMT'), 30_000);
  });

  it('returns null for invalid dates and non-GMT zones', () => {
    clock.epochBase = Date.UTC(2026, 9, 28, 4, 0, 0);
    for (const bad of [
      'Wed, 31 Apr 2026 04:00:10 GMT',
      'Wed, 99 Oct 2026 04:00:10 GMT',
      'Wed, 28 Oct 2026 24:00:10 GMT',
      'Wed, 28 Oct 2026 04:60:10 GMT',
      'Wed, 28 Oct 2026 04:00:10.5 GMT',
      'Wed, 28 Oct 2026 04:00:10 +0700',
      'Wednesday, 28 Oct 2026 04:00:10 GMT',
      'Wed Oct 28 04:00:10 2026',
      'Wed, 28 Oct 26 04:00:10 GMT',
    ]) {
      assert.equal(parseRetryAfter(bad), null, bad);
    }
  });
});
