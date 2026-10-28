import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  after,
  Channel,
  ChannelError,
  createTaskGroup,
  KeyedMutex,
  Mutex,
  QueueError,
  receive,
  RWMutex,
  select,
  send,
  spawn,
  whenAborted,
  withLock,
} from '../../src/async/index.ts';
import { DefectError } from '../../src/result/index.ts';
import { deferred, flush, settled } from '../helpers/deferred.ts';
import { installFakeClock, type FakeClock } from '../helpers/fake-clock.ts';
import { seededRandom } from '../helpers/random.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const closed = (error: unknown) => error instanceof ChannelError && error.code === 'CHANNEL_CLOSED';

describe('Channel', () => {
  it('hands a value straight to a waiting receive without buffering', async () => {
    const channel = new Channel<string>();
    const waiting = channel.receive();
    assert.equal(channel.pendingReceives, 1);
    await channel.send('direct');
    assert.equal(channel.size, 0);
    assert.equal(await waiting, 'direct');
  });

  it('makes an unbuffered send wait for a receive', async () => {
    const channel = new Channel<string>();
    const sending = settled(channel.send('a'));
    await flush();
    assert.equal(sending.state, 'pending');
    assert.equal(channel.pendingSends, 1);
    assert.equal(await channel.receive(), 'a');
    await flush();
    assert.equal(sending.state, 'fulfilled');
    assert.equal(channel.pendingSends, 0);
  });

  it('buffers up to capacity and promotes a waiting send on receive', async () => {
    const channel = new Channel<number>(2);
    assert.equal(channel.capacity, 2);
    await channel.send(1);
    await channel.send(2);
    const third = channel.send(3);
    assert.equal(channel.pendingSends, 1);
    assert.equal(await channel.receive(), 1);
    await third;
    assert.equal(channel.size, 2);
    assert.deepEqual([await channel.receive(), await channel.receive()], [2, 3]);
  });

  it('serves waiting sends in FIFO order', async () => {
    const channel = new Channel<string>();
    const sends = ['x', 'y', 'z'].map((value) => channel.send(value));
    const order: string[] = [];
    for (let index = 0; index < 3; index++) order.push(await channel.receive());
    await Promise.all(sends);
    assert.deepEqual(order, ['x', 'y', 'z']);
  });

  it('rejects sends beyond maxPending with QUEUE_FULL', async () => {
    const channel = new Channel<number>({ maxPending: 1 });
    const first = channel.send(1);
    await assert.rejects(channel.send(2), (error: unknown) => error instanceof QueueError && error.code === 'QUEUE_FULL');
    assert.equal(await channel.receive(), 1);
    await first;
  });

  it('drains buffered values after close and then rejects CHANNEL_CLOSED', async () => {
    const channel = new Channel<number>(1);
    await channel.send(9);
    channel.close();
    channel.close();
    assert.equal(channel.closed, true);
    assert.equal(await channel.receive(), 9);
    await assert.rejects(channel.receive(), closed);
    await assert.rejects(channel.send(1), closed);
  });

  it('rejects waiting sends and receives when closing', async () => {
    const receiving = new Channel<number>();
    const waitingReceive = receiving.receive();
    receiving.close();
    await assert.rejects(waitingReceive, closed);
    const sending = new Channel<number>();
    const waitingSend = sending.send(1);
    sending.close();
    await assert.rejects(waitingSend, closed);
    assert.equal(sending.pendingSends, 0);
  });

  it('removes aborted waiters and rejects with the reason', async () => {
    const channel = new Channel<number>();
    const receiveController = new AbortController();
    const waitingReceive = channel.receive({ signal: receiveController.signal });
    receiveController.abort('nope');
    await assert.rejects(waitingReceive, (reason: unknown) => reason === 'nope');
    assert.equal(channel.pendingReceives, 0);
    const sendController = new AbortController();
    const waitingSend = channel.send(1, { signal: sendController.signal });
    sendController.abort('stop');
    await assert.rejects(waitingSend, (reason: unknown) => reason === 'stop');
    assert.equal(channel.pendingSends, 0);
    await assert.rejects(channel.send(1, { signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
    await assert.rejects(channel.receive({ signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
  });

  it('offers non-blocking trySend and tryReceive', () => {
    const channel = new Channel<number | undefined>(1);
    assert.deepEqual(channel.tryReceive(), { ok: false, closed: false });
    assert.equal(channel.trySend(undefined), true);
    assert.equal(channel.trySend(2), false);
    assert.deepEqual(channel.tryReceive(), { ok: true, value: undefined });
    channel.close();
    assert.deepEqual(channel.tryReceive(), { ok: false, closed: true });
    assert.throws(() => channel.trySend(3), closed);
  });

  it('lets trySend hand off to a waiting receive on an unbuffered channel', async () => {
    const channel = new Channel<string>();
    assert.equal(channel.trySend('nobody'), false);
    const waiting = channel.receive();
    assert.equal(channel.trySend('handed'), true);
    assert.equal(await waiting, 'handed');
    const sending = channel.send('queued');
    assert.deepEqual(channel.tryReceive(), { ok: true, value: 'queued' });
    await sending;
  });

  it('iterates until closed and drained, and values() honors a signal', async () => {
    const channel = new Channel<number>(4);
    await channel.send(1);
    await channel.send(2);
    channel.close();
    const seen: number[] = [];
    for await (const value of channel) seen.push(value);
    assert.deepEqual(seen, [1, 2]);
    const open = new Channel<number>();
    const controller = new AbortController();
    const loop = (async () => {
      for await (const value of open.values({ signal: controller.signal })) seen.push(value);
    })();
    controller.abort('done');
    await assert.rejects(loop, (reason: unknown) => reason === 'done');
  });

  it('exposes send-only and receive-only views over the same state', async () => {
    const channel = new Channel<number>(1);
    const tx = channel.sendOnly();
    const rx = channel.receiveOnly();
    assert.equal(channel.sendOnly(), tx);
    assert.equal(channel.receiveOnly(), rx);
    assert.equal('receive' in tx, false);
    assert.equal('close' in rx, false);
    assert.equal('send' in rx, false);
    await tx.send(5);
    assert.equal(rx.size, 1);
    assert.equal(tx.trySend(6), false);
    assert.deepEqual(rx.tryReceive(), { ok: true, value: 5 });
    assert.deepEqual([tx.capacity, tx.pendingSends, tx.pendingReceives, tx.closed], [1, 0, 0, false]);
    const waiting = rx.receive();
    await tx.send(7);
    assert.equal(await waiting, 7);
    await tx.send(8);
    tx.close();
    const seen: number[] = [];
    for await (const value of rx) seen.push(value);
    for await (const value of rx.values()) seen.push(value);
    assert.deepEqual(seen, [8]);
  });

  it('matches a FIFO model under random non-blocking operations', () => {
    const random = seededRandom(7);
    const channel = new Channel<number>(5);
    const model: number[] = [];
    for (let step = 0; step < 5_000; step++) {
      if (random() < 0.5) {
        const accepted = channel.trySend(step);
        assert.equal(accepted, model.length < 5);
        if (accepted) model.push(step);
      } else {
        const result = channel.tryReceive();
        if (model.length === 0) assert.deepEqual(result, { ok: false, closed: false });
        else assert.deepEqual(result, { ok: true, value: model.shift() });
      }
      assert.equal(channel.size, model.length);
    }
  });

  it('passes values by reference', async () => {
    const channel = new Channel<{ tag: string }>(1);
    const value = { tag: 'same' };
    await channel.send(value);
    assert.equal(await channel.receive(), value);
  });

  it('validates options and arguments', async () => {
    assert.throws(() => new Channel(-1), code('INVALID_ARGUMENT'));
    assert.throws(() => new Channel({ maxPending: 1.5 }), code('INVALID_ARGUMENT'));
    assert.throws(() => new Channel('x' as never), code('INVALID_ARGUMENT'));
    const channel = new Channel<number>();
    await assert.rejects(channel.send(1, { signal: 'x' as never }), code('INVALID_ARGUMENT'));
    await assert.rejects(channel.receive({ signal: 'x' as never }), code('INVALID_ARGUMENT'));
    await assert.rejects(channel.send(1, null as never), code('INVALID_ARGUMENT'));
    await assert.rejects(channel.receive(null as never), code('INVALID_ARGUMENT'));
  });
});

describe('select', () => {
  let clock: FakeClock;
  let restore: () => void;

  beforeEach(() => {
    ({ clock, restore } = installFakeClock());
  });

  afterEach(() => restore());

  it('takes a ready receive at once', async () => {
    const jobs = new Channel<string>(1);
    const quit = new Channel<void>();
    await jobs.send('job');
    const [value, index] = await select([receive(jobs), receive(quit)]);
    assert.equal(index, 0);
    assert.deepEqual(value, { ok: true, value: 'job' });
    assert.equal(jobs.size, 0);
  });

  it('picks randomly among ready cases using the injected random', async () => {
    const a = new Channel<string>(1);
    const b = new Channel<string>(1);
    await a.send('a');
    await b.send('b');
    clock.randomValue = 0.99;
    const [value, index] = await select([receive(a), receive(b)]);
    assert.equal(index, 1);
    assert.deepEqual(value, { ok: true, value: 'b' });
    assert.equal(a.size, 1);
  });

  it('returns the default when nothing is ready', async () => {
    const channel = new Channel<number>();
    assert.deepEqual(await select([receive(channel)], { default: null }), [null, -1]);
    assert.deepEqual(await select([], { default: 'empty' }), ['empty', -1]);
    assert.equal(channel.pendingReceives, 0);
  });

  it('waits for the first case and releases the others without consuming', async () => {
    const a = new Channel<string>();
    const b = new Channel<string>();
    const choice = select([receive(a), receive(b), after(1000)]);
    assert.equal(a.pendingReceives, 1);
    assert.equal(b.pendingReceives, 1);
    await b.send('from b');
    assert.deepEqual(await choice, [{ ok: true, value: 'from b' }, 1]);
    assert.equal(a.pendingReceives, 0);
    assert.equal(clock.pendingTimers, 0);
    assert.equal(a.trySend('kept'), false);
  });

  it('never loses a value when two cases become ready in one tick', async () => {
    const a = new Channel<string>(1);
    const b = new Channel<string>(1);
    const choice = select([receive(a), receive(b)]);
    a.trySend('first');
    b.trySend('second');
    assert.deepEqual(await choice, [{ ok: true, value: 'first' }, 0]);
    assert.deepEqual(b.tryReceive(), { ok: true, value: 'second' });
  });

  it('fires an after case on the injected clock', async () => {
    const channel = new Channel<number>();
    const choice = settled(select([receive(channel), after(500)]));
    await clock.advance(499);
    assert.equal(choice.state, 'pending');
    await clock.advance(1);
    assert.deepEqual(choice.value, [undefined, 1]);
    assert.equal(channel.pendingReceives, 0);
  });

  it('sends to a waiting receiver or parks until one arrives', async () => {
    const channel = new Channel<number>();
    const waiting = channel.receive();
    assert.deepEqual(await select([send(channel, 1)]), [undefined, 0]);
    assert.equal(await waiting, 1);
    const parked = select([send(channel, 2), after(100)]);
    assert.equal(channel.pendingSends, 1);
    assert.equal(await channel.receive(), 2);
    assert.deepEqual(await parked, [undefined, 0]);
    assert.equal(clock.pendingTimers, 0);
  });

  it('pairs a parked select receive with a select send', async () => {
    const channel = new Channel<string>();
    const receiver = select([receive(channel)]);
    assert.deepEqual(await select([send(channel, 'hello')]), [undefined, 0]);
    assert.deepEqual(await receiver, [{ ok: true, value: 'hello' }, 0]);
  });

  it('reports a closed receive case and rejects a closed send case', async () => {
    const channel = new Channel<number>();
    const waiting = select([receive(channel)]);
    channel.close();
    assert.deepEqual(await waiting, [{ ok: false, closed: true }, 0]);
    assert.deepEqual(await select([receive(channel)]), [{ ok: false, closed: true }, 0]);
    await assert.rejects(select([send(channel, 1)]), closed);
    const open = new Channel<number>();
    const parkedSend = select([send(open, 1)]);
    open.close();
    await assert.rejects(parkedSend, closed);
  });

  it('resolves whenAborted with the reason, ready or later', async () => {
    const channel = new Channel<number>();
    assert.deepEqual(await select([receive(channel), whenAborted(AbortSignal.abort('gone'))]), ['gone', 1]);
    const controller = new AbortController();
    const waiting = select([receive(channel), whenAborted(controller.signal)]);
    controller.abort('later');
    assert.deepEqual(await waiting, ['later', 1]);
    assert.equal(channel.pendingReceives, 0);
  });

  it('rejects when its own signal aborts and releases parked cases', async () => {
    const channel = new Channel<number>();
    const controller = new AbortController();
    const waiting = select([receive(channel), after(1000)], { signal: controller.signal });
    controller.abort('cancel');
    await assert.rejects(waiting, (reason: unknown) => reason === 'cancel');
    assert.equal(channel.pendingReceives, 0);
    assert.equal(clock.pendingTimers, 0);
    await assert.rejects(select([receive(channel)], { signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
  });

  it('pushes a buffered send through when its receive is selected', async () => {
    const channel = new Channel<number>(1);
    await channel.send(1);
    const sending = channel.send(2);
    assert.deepEqual(await select([receive(channel)]), [{ ok: true, value: 1 }, 0]);
    await sending;
    assert.equal(channel.size, 1);
  });

  it('works with channel views', async () => {
    const channel = new Channel<number>(1);
    assert.deepEqual(await select([send(channel.sendOnly(), 3)]), [undefined, 0]);
    assert.deepEqual(await select([receive(channel.receiveOnly())]), [{ ok: true, value: 3 }, 0]);
  });

  it('applies maxPending to parked send cases', async () => {
    const channel = new Channel<number>({ maxPending: 1 });
    const first = channel.send(1);
    await assert.rejects(select([send(channel, 2)]), code('QUEUE_FULL'));
    assert.equal(await channel.receive(), 1);
    await first;
  });

  it('validates cases and options', async () => {
    await assert.rejects(select('x' as never), code('INVALID_ARGUMENT'));
    await assert.rejects(select([{ kind: 'receive' } as never]), code('INVALID_ARGUMENT'));
    await assert.rejects(select([]), code('INVALID_ARGUMENT'));
    await assert.rejects(select([after(1)], null as never), code('INVALID_ARGUMENT'));
    assert.throws(() => receive({} as never), code('INVALID_ARGUMENT'));
    assert.throws(() => send(null as never, 1), code('INVALID_ARGUMENT'));
    assert.throws(() => after(-1), code('INVALID_ARGUMENT'));
    assert.throws(() => whenAborted(undefined as never), code('INVALID_ARGUMENT'));
    assert.throws(() => whenAborted({} as never), code('INVALID_ARGUMENT'));
  });
});

describe('spawn', () => {
  it('runs at once and resolves a success result', async () => {
    let started = false;
    const task = spawn(async ({ signal }) => {
      started = true;
      assert.equal(signal.aborted, false);
      return 42;
    });
    assert.equal(started, true);
    const result = await task.result;
    assert.equal(result.ok && result.data, 42);
  });

  it('captures failures as results instead of rejecting', async () => {
    const task = spawn(() => {
      throw new TypeError('network');
    });
    const result = await task.result;
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof TypeError);
    const mapped = await spawn(() => Promise.reject(new Error('raw')), { mapError: (raw) => (raw as Error).message }).result;
    assert.equal(mapped.error, 'raw');
  });

  it('rejects the result for defects', async () => {
    await assert.rejects(spawn(() => {
      throw new DefectError('bug');
    }).result, DefectError);
  });

  it('aborts the task signal on cancel and on parent abort', async () => {
    const gate = deferred();
    const task = spawn(async ({ signal }) => {
      await gate.promise;
      return signal.reason;
    });
    task.cancel('stop');
    assert.equal(task.signal.aborted, true);
    gate.resolve();
    assert.equal((await task.result).data, 'stop');
    const parent = new AbortController();
    const child = spawn(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))), {
      signal: parent.signal,
    });
    parent.abort('parent');
    assert.equal((await child.result).error, 'parent');
  });

  it('does not call the function when the parent is already aborted', async () => {
    let called = false;
    const task = spawn(() => {
      called = true;
    }, { signal: AbortSignal.abort('early') });
    const result = await task.result;
    assert.equal(called, false);
    assert.equal(result.error, 'early');
  });

  it('validates arguments', () => {
    assert.throws(() => spawn('x' as never), code('INVALID_ARGUMENT'));
    assert.throws(() => spawn(() => 1, null as never), code('INVALID_ARGUMENT'));
    assert.throws(() => spawn(() => 1, { signal: 'x' as never }), code('INVALID_ARGUMENT'));
  });
});

describe('createTaskGroup', () => {
  it('collects values in run order', async () => {
    const group = createTaskGroup<number>();
    const gates = [deferred(), deferred()];
    group.run(async () => {
      await gates[0]!.promise;
      return 1;
    });
    group.run(async () => {
      await gates[1]!.promise;
      return 2;
    });
    assert.equal(group.activeCount, 2);
    gates[1]!.resolve();
    gates[0]!.resolve();
    const result = await group.wait();
    assert.deepEqual(result.ok && result.data, [1, 2]);
    assert.throws(() => group.run(() => 3), code('INVALID_ARGUMENT'));
  });

  it('resolves an empty group and lets tasks run more tasks', async () => {
    assert.deepEqual((await createTaskGroup().wait()).data, []);
    const group = createTaskGroup<string>();
    group.run(async () => {
      group.run(() => 'child');
      return 'parent';
    });
    assert.deepEqual((await group.wait()).data, ['parent', 'child']);
  });

  it('bounds concurrency and queues the rest', async () => {
    const group = createTaskGroup<number>({ concurrency: 1 });
    const gate = deferred();
    group.run(async () => {
      await gate.promise;
      return 1;
    });
    group.run(() => 2);
    assert.equal(group.activeCount, 1);
    assert.equal(group.pendingCount, 1);
    gate.resolve();
    assert.deepEqual((await group.wait()).data, [1, 2]);
  });

  it('cancels siblings and drops queued tasks on the first failure, then waits for running tasks', async () => {
    const group = createTaskGroup<number>({ concurrency: 2 });
    const failure = new Error('boom');
    const gate = deferred();
    let siblingSignal: AbortSignal | undefined;
    let queuedRan = false;
    group.run(async ({ signal }) => {
      siblingSignal = signal;
      await gate.promise;
      return 1;
    });
    group.run(() => {
      throw failure;
    });
    group.run(() => {
      queuedRan = true;
      return 3;
    });
    await flush();
    assert.equal(siblingSignal?.aborted, true);
    assert.equal(group.signal.reason, failure);
    const waiting = settled(group.wait());
    await flush();
    assert.equal(waiting.state, 'pending');
    group.run(() => assert.fail('a stopping group must not start tasks'));
    gate.resolve();
    await flush();
    assert.equal(waiting.state, 'fulfilled');
    assert.equal(waiting.value?.error, failure);
    assert.equal(queuedRan, false);
  });

  it('stops on cancel and on parent abort', async () => {
    const group = createTaskGroup();
    group.cancel('enough');
    group.cancel('again');
    group.run(() => assert.fail('must not start'));
    assert.equal((await group.wait()).error, 'enough');
    const parent = new AbortController();
    const child = createTaskGroup({ signal: parent.signal });
    const gate = deferred();
    child.run(async ({ signal }) => {
      await gate.promise;
      return signal.aborted;
    });
    parent.abort('parent');
    gate.resolve();
    assert.equal((await child.wait()).error, 'parent');
    assert.equal((await createTaskGroup({ signal: AbortSignal.abort('early') }).wait()).error, 'early');
    const defaulted = createTaskGroup();
    defaulted.cancel();
    assert.equal(((await defaulted.wait()).error as Error).name, 'AbortError');
  });

  it('rejects wait for defects and returns the same promise each time', async () => {
    const group = createTaskGroup();
    group.run(() => {
      throw new DefectError('bug');
    });
    const first = group.wait();
    assert.equal(group.wait(), first);
    await assert.rejects(first, DefectError);
  });

  it('validates options and tasks', () => {
    assert.throws(() => createTaskGroup({ concurrency: 0 }), code('INVALID_ARGUMENT'));
    assert.throws(() => createTaskGroup(null as never), code('INVALID_ARGUMENT'));
    assert.throws(() => createTaskGroup({ signal: 'x' as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => createTaskGroup().run('x' as never), code('INVALID_ARGUMENT'));
  });
});

describe('Mutex and withLock', () => {
  it('serializes holders in FIFO order', async () => {
    const mutex = new Mutex();
    const order: number[] = [];
    const release = await mutex.lock();
    assert.equal(mutex.locked, true);
    const waiters = [1, 2].map((id) => mutex.lock().then((next) => {
      order.push(id);
      next();
    }));
    assert.equal(mutex.pendingCount, 2);
    release();
    release();
    await Promise.all(waiters);
    assert.deepEqual(order, [1, 2]);
    assert.equal(mutex.locked, false);
  });

  it('offers tryLock and removes aborted waiters', async () => {
    const mutex = new Mutex();
    const release = mutex.tryLock();
    assert.ok(release);
    assert.equal(mutex.tryLock(), null);
    const controller = new AbortController();
    const waiting = mutex.lock({ signal: controller.signal });
    controller.abort('skip');
    await assert.rejects(waiting, (reason: unknown) => reason === 'skip');
    assert.equal(mutex.pendingCount, 0);
    await assert.rejects(mutex.lock({ signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
    release();
    assert.equal(mutex.locked, false);
    await assert.rejects(mutex.lock(null as never), code('INVALID_ARGUMENT'));
  });

  it('withLock always releases, even when the function throws', async () => {
    const mutex = new Mutex();
    let inside = 0;
    let maxInside = 0;
    const work = async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await flush(1);
      inside--;
      return 'done';
    };
    assert.deepEqual(await Promise.all([withLock(mutex, work), withLock(mutex, work)]), ['done', 'done']);
    assert.equal(maxInside, 1);
    await assert.rejects(withLock(mutex, () => {
      throw new Error('inside');
    }), /inside/);
    assert.equal(mutex.locked, false);
    await assert.rejects(withLock({} as never, () => 1), code('INVALID_ARGUMENT'));
    await assert.rejects(withLock(mutex, 'x' as never), code('INVALID_ARGUMENT'));
  });
});

describe('RWMutex', () => {
  it('admits readers together and writers alone', async () => {
    const lock = new RWMutex();
    const readA = await lock.lockRead();
    const readB = await lock.lockRead();
    assert.equal(lock.readers, 2);
    const write = settled(lock.lockWrite());
    await flush();
    assert.equal(write.state, 'pending');
    readA();
    readA();
    readB();
    await flush();
    assert.equal(write.state, 'fulfilled');
    assert.equal(lock.writing, true);
    (write.value as () => void)();
    assert.equal(lock.writing, false);
  });

  it('holds back readers that arrive after a waiting writer', async () => {
    const lock = new RWMutex();
    const order: string[] = [];
    const firstRead = await lock.lockRead();
    const writer = lock.lockWrite().then((release) => {
      order.push('write');
      release();
    });
    const lateReader = lock.lockRead().then((release) => {
      order.push('read');
      release();
    });
    assert.equal(lock.pendingCount, 2);
    firstRead();
    await Promise.all([writer, lateReader]);
    assert.deepEqual(order, ['write', 'read']);
  });

  it('admits the readers behind an aborted writer', async () => {
    const lock = new RWMutex();
    const firstRead = await lock.lockRead();
    const controller = new AbortController();
    const writer = lock.lockWrite({ signal: controller.signal });
    const reader = settled(lock.lockRead());
    controller.abort('cancel');
    await assert.rejects(writer, (reason: unknown) => reason === 'cancel');
    await flush();
    assert.equal(reader.state, 'fulfilled');
    firstRead();
    (reader.value as () => void)();
    assert.equal(lock.readers, 0);
    await assert.rejects(lock.lockRead({ signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
    await assert.rejects(lock.lockWrite({ signal: 'x' as never }), code('INVALID_ARGUMENT'));
  });
});

describe('KeyedMutex', () => {
  it('serializes per key, runs keys concurrently, and forgets idle keys', async () => {
    const locks = new KeyedMutex();
    const order: string[] = [];
    const gate = deferred();
    const first = locks.with('user:1', async () => {
      await gate.promise;
      order.push('1a');
    });
    const second = locks.with('user:1', () => {
      order.push('1b');
    });
    const other = locks.with('user:2', () => {
      order.push('2');
    });
    await other;
    assert.deepEqual(order, ['2']);
    assert.equal(locks.size, 1);
    gate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['2', '1a', '1b']);
    assert.equal(locks.size, 0);
  });

  it('forgets a key when its only waiter aborts', async () => {
    const locks = new KeyedMutex();
    const gate = deferred();
    const holder = locks.with('k', () => gate.promise);
    const controller = new AbortController();
    const waiter = locks.with('k', () => 1, { signal: controller.signal });
    controller.abort('leave');
    await assert.rejects(waiter, (reason: unknown) => reason === 'leave');
    gate.resolve();
    await holder;
    assert.equal(locks.size, 0);
    await assert.rejects(locks.with('k', () => 1, { signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
    assert.equal(locks.size, 0);
  });

  it('validates keys and functions', async () => {
    const locks = new KeyedMutex();
    await assert.rejects(locks.with(1 as never, () => 1), code('INVALID_ARGUMENT'));
    await assert.rejects(locks.with('k', 'x' as never), code('INVALID_ARGUMENT'));
  });
});
