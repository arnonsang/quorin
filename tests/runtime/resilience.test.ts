import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isUserAbort, withResilience, type RunFailure } from '../../src/resilience/index.ts';
import { DefectError } from '../../src/result/index.ts';
import { deferred, settled } from '../helpers/deferred.ts';
import { installFakeClock, type FakeClock } from '../helpers/fake-clock.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

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
