import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CacheError, createCache, type LoadContext } from '../../src/cache/index.ts';
import { deferred, flush, settled, type Deferred } from '../helpers/deferred.ts';
import { installFakeClock, type FakeClock } from '../helpers/fake-clock.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

let clock: FakeClock;
let restore: () => void;

beforeEach(() => {
  ({ clock, restore } = installFakeClock());
});

afterEach(() => restore());

function controlledLoader<V>() {
  const calls: { key: unknown; signal: AbortSignal; gate: Deferred<V> }[] = [];
  const load = (key: unknown, { signal }: LoadContext) => {
    const gate = deferred<V>();
    calls.push({ key, signal, gate });
    return gate.promise;
  };
  return { calls, load };
}

describe('stored entries', () => {
  it('evicts the least recently used entry and touches on get', () => {
    const cache = createCache<string, number>({ max: 2 });
    cache.set('a', 1).set('b', 2);
    assert.equal(cache.get('a'), 1);
    cache.set('c', 3);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.size, 2);
    assert.equal(cache.max, 2);
  });

  it('supports undefined keys and values without growing past max', () => {
    const cache = createCache<string | undefined, number | undefined>({ max: 1 });
    cache.set(undefined, undefined);
    assert.deepEqual(cache.lookup(undefined), { state: 'fresh', value: undefined });
    cache.set('x', 1);
    assert.equal(cache.size, 1);
    assert.deepEqual(cache.lookup(undefined), { state: 'miss' });
  });

  it('has does not touch LRU order', () => {
    const cache = createCache<string, number>({ max: 2 });
    cache.set('a', 1).set('b', 2);
    assert.equal(cache.has('a'), true);
    cache.set('c', 3);
    assert.equal(cache.has('a'), false);
  });

  it('applies half-open fresh, stale, and expired intervals', async () => {
    const cache = createCache<string, number>({ max: 5, ttlMs: 100, swrMs: 50 });
    cache.set('a', 1);
    await clock.advance(99);
    assert.equal(cache.get('a'), 1);
    await clock.advance(1);
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.has('a'), false);
    assert.deepEqual(cache.lookup('a'), { state: 'stale', value: 1 });
    assert.equal(cache.size, 1);
    await clock.advance(50);
    assert.deepEqual(cache.lookup('a'), { state: 'miss' });
    assert.equal(cache.size, 0);
  });

  it('treats ttl zero as immediately expired', () => {
    const cache = createCache<string, number>({ max: 5, ttlMs: 0 });
    cache.set('a', 1);
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size, 0);
  });

  it('deletes and clears', () => {
    const cache = createCache<string, number>({ max: 5 });
    cache.set('a', 1);
    assert.equal(cache.delete('a'), true);
    assert.equal(cache.delete('a'), false);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it('validates options', () => {
    assert.throws(() => createCache({ max: 0 }), code('INVALID_ARGUMENT'));
    assert.throws(() => createCache({ max: 1, ttlMs: -1 }), code('INVALID_ARGUMENT'));
    assert.throws(() => createCache({ max: 1, swrMs: Infinity }), code('INVALID_ARGUMENT'));
    assert.throws(() => createCache({ max: 1, load: 1 as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => createCache({ max: 1, load: () => 1, maxInFlight: 0 }), code('INVALID_ARGUMENT'));
    assert.throws(() => createCache({ max: 1, load: () => 1, onBackgroundError: 1 as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => createCache(null as never), code('INVALID_ARGUMENT'));
  });

  it('rejects getOrFetch without a loader', async () => {
    const cache = createCache<string, number>({ max: 1 }) as unknown as { getOrFetch(key: string): Promise<number> };
    await assert.rejects(cache.getOrFetch('a'), code('INVALID_ARGUMENT'));
  });
});

describe('getOrFetch', () => {
  it('coalesces identical concurrent misses', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const a = cache.getOrFetch('k');
    const b = cache.getOrFetch('k');
    assert.equal(calls.length, 1);
    assert.equal(cache.inFlightCount, 1);
    calls[0]!.gate.resolve(7);
    assert.deepEqual(await Promise.all([a, b]), [7, 7]);
    assert.equal(cache.get('k'), 7);
    assert.equal(cache.inFlightCount, 0);
    assert.equal(await cache.getOrFetch('k'), 7);
    assert.equal(calls.length, 1);
  });

  it('caches undefined results', async () => {
    let calls = 0;
    const cache = createCache<string, undefined>({ max: 5, load: () => {
      calls++;
      return undefined;
    } });
    assert.equal(await cache.getOrFetch('k'), undefined);
    assert.equal(await cache.getOrFetch('k'), undefined);
    assert.equal(calls, 1);
  });

  it('rejects all waiters on failure and caches nothing', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const a = cache.getOrFetch('k');
    const b = cache.getOrFetch('k');
    calls[0]!.gate.reject(new Error('down'));
    await assert.rejects(a, /down/);
    await assert.rejects(b, /down/);
    assert.equal(cache.size, 0);
  });

  it('handles synchronous loader throws', async () => {
    const cache = createCache<string, number>({ max: 5, load: () => {
      throw new Error('sync');
    } });
    await assert.rejects(cache.getOrFetch('k'), /sync/);
    assert.equal(cache.inFlightCount, 0);
  });

  it('does not let a load repopulate after clear', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const pending = cache.getOrFetch('k');
    cache.clear();
    await assert.rejects(pending, (error) => error instanceof CacheError && error.code === 'CACHE_INVALIDATED');
    assert.equal(calls[0]!.signal.aborted, true);
    calls[0]!.gate.resolve(1);
    await flush();
    assert.equal(cache.size, 0);
    assert.equal(cache.inFlightCount, 0);
  });

  it('does not let an old load overwrite a newer set', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const pending = cache.getOrFetch('k');
    cache.set('k', 2);
    await assert.rejects(pending, code('CACHE_INVALIDATED'));
    calls[0]!.gate.resolve(1);
    await flush();
    assert.equal(cache.get('k'), 2);
  });

  it('keeps a replacement flight when an old flight finishes', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const first = cache.getOrFetch('k');
    assert.equal(cache.delete('k'), true);
    await assert.rejects(first, code('CACHE_INVALIDATED'));
    const second = cache.getOrFetch('k');
    assert.equal(calls.length, 2);
    calls[0]!.gate.resolve(1);
    await flush();
    const third = cache.getOrFetch('k');
    assert.equal(calls.length, 2);
    calls[1]!.gate.resolve(2);
    assert.deepEqual(await Promise.all([second, third]), [2, 2]);
  });

  it('rejects only the aborting waiter', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const controller = new AbortController();
    const leaving = cache.getOrFetch('k', { signal: controller.signal });
    const staying = cache.getOrFetch('k');
    controller.abort('leave');
    await assert.rejects(leaving, (error) => error === 'leave');
    assert.equal(calls[0]!.signal.aborted, false);
    calls[0]!.gate.resolve(3);
    assert.equal(await staying, 3);
  });

  it('aborts the flight when every blocking waiter leaves', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load });
    const controller = new AbortController();
    const only = cache.getOrFetch('k', { signal: controller.signal });
    controller.abort('gone');
    await assert.rejects(only);
    assert.equal(calls[0]!.signal.aborted, true);
    assert.equal(cache.inFlightCount, 1);
    calls[0]!.gate.resolve(1);
    await flush();
    assert.equal(cache.size, 0);
    assert.equal(cache.inFlightCount, 0);
    await assert.rejects(cache.getOrFetch('k', { signal: AbortSignal.abort('pre') }), (error) => error === 'pre');
  });

  it('enforces maxInFlight including detached loaders', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load, maxInFlight: 1 });
    const first = cache.getOrFetch('a');
    const joined = cache.getOrFetch('a');
    await assert.rejects(cache.getOrFetch('b'), code('CACHE_BUSY'));
    cache.delete('a');
    await assert.rejects(first);
    await assert.rejects(joined);
    await assert.rejects(cache.getOrFetch('b'), code('CACHE_BUSY'));
    calls[0]!.gate.resolve(0);
    await flush();
    const next = cache.getOrFetch('b');
    calls[1]!.gate.resolve(2);
    assert.equal(await next, 2);
  });

  it('times out loads without freeing the slot early', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, load, loadTimeoutMs: 100 });
    const pending = cache.getOrFetch('k');
    const state = settled(pending);
    await clock.advance(100);
    assert.equal(state.state, 'rejected');
    assert.equal((state.reason as CacheError).code, 'CACHE_LOAD_TIMEOUT');
    assert.equal(calls[0]!.signal.aborted, true);
    assert.equal(cache.inFlightCount, 1);
    calls[0]!.gate.resolve(1);
    await flush();
    assert.equal(cache.inFlightCount, 0);
    assert.equal(cache.size, 0);
  });
});

describe('stale while revalidate', () => {
  it('returns stale data and refreshes in the background once', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, ttlMs: 100, swrMs: 100, load });
    cache.set('k', 1);
    await clock.advance(150);
    const tasks: Promise<void>[] = [];
    const controller = new AbortController();
    assert.equal(await cache.getOrFetch('k', { signal: controller.signal, onBackgroundTask: (task) => tasks.push(task) }), 1);
    assert.equal(await cache.getOrFetch('k', { onBackgroundTask: (task) => tasks.push(task) }), 1);
    controller.abort();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.signal.aborted, false);
    assert.equal(tasks.length, 2);
    const done = settled(tasks[0]!);
    calls[0]!.gate.resolve(2);
    await flush();
    assert.equal(done.state, 'fulfilled');
    assert.equal(cache.get('k'), 2);
  });

  it('keeps stale data only until the original deadline after a failed refresh', async () => {
    const { calls, load } = controlledLoader<number>();
    const errors: [unknown, string][] = [];
    const cache = createCache<string, number>({ max: 5, ttlMs: 100, swrMs: 100, load, onBackgroundError: (error, key) => {
      errors.push([error, key]);
      throw new Error('observer failure is isolated');
    } });
    cache.set('k', 1);
    await clock.advance(150);
    assert.equal(await cache.getOrFetch('k'), 1);
    calls[0]!.gate.reject('refresh failed');
    await flush();
    assert.deepEqual(errors, [['refresh failed', 'k']]);
    assert.deepEqual(cache.lookup('k'), { state: 'stale', value: 1 });
    await clock.advance(50);
    assert.deepEqual(cache.lookup('k'), { state: 'miss' });
  });

  it('invalidates a refresh when its entry is evicted', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 1, ttlMs: 100, swrMs: 100, load });
    cache.set('a', 1);
    await clock.advance(150);
    await cache.getOrFetch('a');
    cache.set('b', 2);
    assert.equal(calls[0]!.signal.aborted, true);
    calls[0]!.gate.resolve(10);
    await flush();
    assert.equal(cache.has('a'), false);
    assert.equal(cache.get('b'), 2);
  });

  it('a hard miss joins an existing refresh', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, ttlMs: 100, swrMs: 100, load });
    cache.set('k', 1);
    await clock.advance(150);
    await cache.getOrFetch('k');
    await clock.advance(100);
    const blocking = cache.getOrFetch('k');
    assert.equal(calls.length, 1);
    calls[0]!.gate.resolve(5);
    assert.equal(await blocking, 5);
  });

  it('skips background refresh when admission is unavailable', async () => {
    const { calls, load } = controlledLoader<number>();
    const cache = createCache<string, number>({ max: 5, ttlMs: 100, swrMs: 100, load, maxInFlight: 1 });
    cache.set('stale', 1);
    const other = cache.getOrFetch('other');
    await clock.advance(150);
    let reported = false;
    assert.equal(await cache.getOrFetch('stale', { onBackgroundTask: () => {
      reported = true;
    } }), 1);
    assert.equal(reported, false);
    assert.equal(calls.length, 1);
    calls[0]!.gate.resolve(0);
    await other;
  });

  it('reports background load timeouts and isolates onBackgroundTask errors', async () => {
    const { load } = controlledLoader<number>();
    const errors: unknown[] = [];
    const cache = createCache<string, number>({ max: 5, ttlMs: 10, swrMs: 1000, load, loadTimeoutMs: 50, onBackgroundError: (error) => errors.push(error) });
    cache.set('k', 1);
    await clock.advance(20);
    assert.equal(await cache.getOrFetch('k', { onBackgroundTask: () => {
      throw new Error('ignored');
    } }), 1);
    await clock.advance(50);
    assert.equal((errors[0] as CacheError).code, 'CACHE_LOAD_TIMEOUT');
  });

  it('validates getOrFetch options', async () => {
    const cache = createCache<string, number>({ max: 5, load: () => 1 });
    await assert.rejects(cache.getOrFetch('k', { signal: 1 as never }), code('INVALID_ARGUMENT'));
    await assert.rejects(cache.getOrFetch('k', { onBackgroundTask: 1 as never }), code('INVALID_ARGUMENT'));
  });
});
