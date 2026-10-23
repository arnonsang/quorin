import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concurrencyLimit } from '../../src/async/index.ts';
import { fromHex } from '../../src/bytes/index.ts';
import { createCache } from '../../src/cache/index.ts';
import { setPath, stableStringify } from '../../src/object/index.ts';
import { withResilience } from '../../src/resilience/index.ts';
import { err, ok, trySafe } from '../../src/result/index.ts';
import { isEqual, redact, safeClone } from '../../src/state/index.ts';
import { Deque, ValueMap } from '../../src/struct/index.ts';
import { deferred, flush } from '../helpers/deferred.ts';

describe('regressions', () => {
  it('deque with capacity 10 pops in LIFO order', () => {
    const deque = new Deque<number>(10);
    deque.push(1);
    deque.push(2);
    deque.push(3);
    assert.deepEqual([deque.pop(), deque.pop(), deque.pop()], [3, 2, 1]);
  });

  it('distinct Map and Set contents are not equal', () => {
    assert.equal(isEqual(new Map([[1, 1]]), new Map([[2, 2]])), false);
    assert.equal(isEqual(new Set([1]), new Set([2])), false);
  });

  it('a class with private fields is rejected instead of half cloned', () => {
    class Secret {
      #value = 1;
      read(): number {
        return this.#value;
      }
    }
    assert.throws(() => safeClone(new Secret()), { code: 'UNSUPPORTED_VALUE' });
  });

  it('serializing [undefined, 1] is rejected', () => {
    assert.throws(() => stableStringify([undefined, 1] as never), { code: 'UNSUPPORTED_VALUE' });
  });

  it('malformed hex is rejected', () => {
    assert.throws(() => fromHex('gg'), { code: 'INVALID_ENCODING' });
    assert.throws(() => fromHex('1g'), { code: 'INVALID_ENCODING' });
  });

  it('a cache with max 1 stays bounded when the first key is undefined', () => {
    const cache = createCache<string | undefined, number>({ max: 1 });
    cache.set(undefined, 1).set('b', 2);
    assert.equal(cache.size, 1);
  });

  it('clear during a load prevents repopulation', async () => {
    const gate = deferred<number>();
    const cache = createCache<string, number>({ max: 5, load: () => gate.promise });
    const pending = cache.getOrFetch('k');
    cache.clear();
    gate.resolve(1);
    await assert.rejects(pending, { code: 'CACHE_INVALIDATED' });
    await flush();
    assert.equal(cache.size, 0);
  });

  it('an old load cannot overwrite a newer set', async () => {
    const gate = deferred<number>();
    const cache = createCache<string, number>({ max: 5, load: () => gate.promise });
    const pending = cache.getOrFetch('k');
    cache.set('k', 2);
    gate.resolve(1);
    await assert.rejects(pending, { code: 'CACHE_INVALIDATED' });
    await flush();
    assert.equal(cache.get('k'), 2);
  });

  it('results are real arrays', () => {
    const result = ok(1);
    assert.equal(Array.isArray(result), true);
    assert.equal(typeof result.slice, 'function');
  });

  it('err(null) is still a failure', () => {
    assert.equal(err(null).ok, false);
  });

  it('a task that ignores its signal still times out', async () => {
    const result = await withResilience(() => new Promise(() => {}), { attemptTimeoutMs: 5 });
    assert.equal(result.ok, false);
  });

  it('aborting a queued task behind a blocked task rejects promptly', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const blocked = limit(() => gate.promise);
    const controller = new AbortController();
    const queued = limit(() => 1, { signal: controller.signal });
    controller.abort('cancel');
    await assert.rejects(queued, (error) => error === 'cancel');
    gate.resolve();
    await blocked;
  });

  it('a synchronous throw releases the limiter slot', async () => {
    const limit = concurrencyLimit(1);
    await assert.rejects(limit(() => {
      throw new Error('sync');
    }));
    assert.equal(limit.activeCount, 0);
  });

  it('redacting a cyclic object does not overflow', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    assert.deepEqual(redact(value), { self: '[CIRCULAR]' });
  });

  it('setPath does not mutate inherited objects', () => {
    const inherited = { nested: { value: 1 } };
    assert.throws(() => setPath(Object.create(inherited) as Record<string, unknown>, 'nested.value', 2));
    assert.equal(inherited.nested.value, 1);
  });

  it('mutating a ValueMap key after insertion keeps the original lookup', () => {
    const map = new ValueMap<{ id: number }, string>();
    const key = { id: 1 };
    map.set(key, 'x');
    key.id = 2;
    assert.equal(map.get({ id: 1 }), 'x');
  });

  it('an operational TypeError is captured, not treated as a defect', async () => {
    const result = await trySafe(() => Promise.reject(new TypeError('fetch failed')));
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof TypeError);
  });
});
