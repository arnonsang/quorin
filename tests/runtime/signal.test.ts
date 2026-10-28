import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { onAbort, timeoutSignal } from '../../src/signal/index.ts';
import { installFakeClock, type FakeClock } from '../helpers/fake-clock.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

let clock: FakeClock;
let restore: () => void;

beforeEach(() => {
  ({ clock, restore } = installFakeClock());
});

afterEach(() => restore());

describe('onAbort', () => {
  it('delivers the reason on abort and detaches the listener', async () => {
    const controller = new AbortController();
    const reasons: unknown[] = [];
    const unsubscribe = onAbort(controller.signal, (reason) => reasons.push(reason));
    controller.abort('stop');
    unsubscribe();
    assert.deepEqual(reasons, ['stop']);
  });

  it('invokes the listener synchronously for an already aborted signal', () => {
    const reasons: unknown[] = [];
    const unsubscribe = onAbort(AbortSignal.abort('early'), (reason) => reasons.push(reason));
    unsubscribe();
    assert.deepEqual(reasons, ['early']);
  });

  it('never fires without a signal and tolerates repeated unsubscribes', () => {
    let fired = 0;
    const unsubscribe = onAbort(undefined, () => fired++);
    unsubscribe();
    unsubscribe();
    assert.equal(fired, 0);
  });

  it('stops delivery after unsubscribing', () => {
    const controller = new AbortController();
    let fired = 0;
    const unsubscribe = onAbort(controller.signal, () => fired++);
    unsubscribe();
    unsubscribe();
    controller.abort('late');
    assert.equal(fired, 0);
  });
});

describe('timeoutSignal', () => {
  it('aborts with a TimeoutError when the deadline elapses', async () => {
    const timeout = timeoutSignal(100);
    assert.equal(timeout.signal.aborted, false);
    await clock.advance(99);
    assert.equal(timeout.signal.aborted, false);
    await clock.advance(1);
    assert.equal(timeout.signal.aborted, true);
    assert.equal((timeout.signal.reason as Error).name, 'TimeoutError');
    assert.equal(clock.pendingTimers, 0);
  });

  it('clears the timer on cancel without aborting', async () => {
    const timeout = timeoutSignal(100);
    timeout.cancel();
    timeout.cancel();
    await clock.advance(1000);
    assert.equal(timeout.signal.aborted, false);
    assert.equal(clock.pendingTimers, 0);
  });

  it('aborts with the parent reason and clears the timer when the parent aborts first', async () => {
    const controller = new AbortController();
    const timeout = timeoutSignal(100, { signal: controller.signal });
    await clock.advance(10);
    controller.abort('parent');
    assert.equal(timeout.signal.aborted, true);
    assert.equal(timeout.signal.reason, 'parent');
    assert.equal(clock.pendingTimers, 0);
  });

  it('aborts immediately for an already aborted parent', () => {
    const timeout = timeoutSignal(100, { signal: AbortSignal.abort('upstream') });
    assert.equal(timeout.signal.aborted, true);
    assert.equal(timeout.signal.reason, 'upstream');
    assert.equal(clock.pendingTimers, 0);
  });

  it('ignores a late parent abort after the deadline fired', async () => {
    const controller = new AbortController();
    const timeout = timeoutSignal(50, { signal: controller.signal });
    await clock.advance(50);
    assert.equal((timeout.signal.reason as Error).name, 'TimeoutError');
    controller.abort('late parent');
    assert.equal((timeout.signal.reason as Error).name, 'TimeoutError');
  });

  it('expires on the next timer tick for zero milliseconds', async () => {
    const timeout = timeoutSignal(0);
    assert.equal(timeout.signal.aborted, false);
    await clock.advance(0);
    assert.equal(timeout.signal.aborted, true);
  });

  it('validates arguments', () => {
    assert.throws(() => timeoutSignal(-1), code('INVALID_ARGUMENT'));
    assert.throws(() => timeoutSignal(Number.NaN), code('INVALID_ARGUMENT'));
    assert.throws(() => timeoutSignal(2 ** 31), code('INVALID_ARGUMENT'));
    assert.throws(() => timeoutSignal(100, null as never), code('INVALID_ARGUMENT'));
    assert.throws(() => timeoutSignal(100, { signal: 'x' as never }), code('INVALID_ARGUMENT'));
  });
});
