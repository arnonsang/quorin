import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Deque, Multimap, ValueMap } from '../../src/struct/index.ts';
import { seededRandom } from '../helpers/random.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

describe('Deque', () => {
  it('works with a non power of two capacity', () => {
    const deque = new Deque<number>(10);
    deque.push(1);
    deque.push(2);
    deque.push(3);
    assert.deepEqual([deque.pop(), deque.pop(), deque.pop()], [3, 2, 1]);
  });

  it('wraps around in both directions and grows in logical order', () => {
    const deque = new Deque<number>(1);
    for (let index = 1; index <= 5; index++) deque.unshift(-index);
    for (let index = 0; index < 20; index++) deque.push(index);
    assert.deepEqual([...deque], [-5, -4, -3, -2, -1, ...Array.from({ length: 20 }, (_, index) => index)]);
    assert.equal(deque.peek(), -5);
    assert.equal(deque.peekBack(), 19);
  });

  it('stores undefined and reports emptiness through size', () => {
    const deque = new Deque<undefined>();
    assert.equal(deque.push(undefined), 1);
    assert.equal(deque.size, 1);
    assert.equal(deque.shift(), undefined);
    assert.equal(deque.size, 0);
    assert.equal(deque.shift(), undefined);
  });

  it('clears after wraparound', () => {
    const deque = new Deque<number>(8);
    for (let index = 0; index < 6; index++) deque.push(index);
    for (let index = 0; index < 4; index++) deque.shift();
    for (let index = 0; index < 6; index++) deque.push(index);
    deque.clear();
    assert.equal(deque.size, 0);
    deque.push(7);
    assert.deepEqual([...deque], [7]);
  });

  it('rejects invalid capacities', () => {
    assert.throws(() => new Deque(0), code('INVALID_ARGUMENT'));
    assert.throws(() => new Deque(1.5), code('INVALID_ARGUMENT'));
    assert.throws(() => new Deque(2 ** 31), code('INVALID_ARGUMENT'));
  });

  it('throws when modified during iteration', () => {
    const deque = new Deque<number>();
    deque.push(1);
    deque.push(2);
    assert.throws(() => {
      for (const value of deque) deque.push(value);
    }, code('CONCURRENT_MODIFICATION'));
  });

  it('matches an array model for random operations', () => {
    const random = seededRandom(42);
    const deque = new Deque<number>(3);
    const model: number[] = [];
    for (let step = 0; step < 20_000; step++) {
      const choice = Math.floor(random() * 4);
      if (choice === 0) assert.equal(deque.push(step), model.push(step));
      else if (choice === 1) assert.equal(deque.unshift(step), model.unshift(step));
      else if (choice === 2) assert.equal(deque.pop(), model.pop());
      else assert.equal(deque.shift(), model.shift());
      assert.equal(deque.size, model.length);
      assert.equal(deque.peek(), model[0]);
      assert.equal(deque.peekBack(), model[model.length - 1]);
    }
    assert.deepEqual([...deque], model);
  });
});

describe('ValueMap', () => {
  it('compares records structurally regardless of key order', () => {
    const map = new ValueMap<{ a: number; b: number }, string>();
    map.set({ a: 1, b: 2 }, 'x');
    assert.equal(map.get({ b: 2, a: 1 }), 'x');
    assert.equal(map.has(Object.assign(Object.create(null), { a: 1, b: 2 })), true);
    map.set({ b: 2, a: 1 }, 'y');
    assert.equal(map.size, 1);
    assert.equal(map.get({ a: 1, b: 2 }), 'y');
  });

  it('keeps array order significant and normalizes negative zero', () => {
    const map = new ValueMap<number[], number>();
    map.set([1, 2], 1);
    assert.equal(map.has([2, 1]), false);
    map.set([-0], 2);
    assert.equal(map.get([0]), 2);
  });

  it('snapshots keys on insertion', () => {
    const map = new ValueMap<{ id: number }, string>();
    const key = { id: 1 };
    map.set(key, 'one');
    key.id = 2;
    assert.equal(map.get({ id: 1 }), 'one');
    assert.equal(map.has({ id: 2 }), false);
    assert.equal(map.size, 1);
  });

  it('returns detached key snapshots from iteration', () => {
    const map = new ValueMap<{ id: number }, string>();
    map.set({ id: 1 }, 'one');
    for (const [key] of map) key.id = 99;
    assert.equal(map.get({ id: 1 }), 'one');
    assert.deepEqual([...map.keys()], [{ id: 1 }]);
  });

  it('rejects unsupported keys consistently', () => {
    const map = new ValueMap<never, number>();
    for (const bad of [undefined, NaN, new Date(), [, 1], new Map()]) {
      assert.throws(() => map.set(bad as never, 1), code('UNSUPPORTED_VALUE'));
      assert.throws(() => map.get(bad as never), code('UNSUPPORTED_VALUE'));
      assert.throws(() => map.has(bad as never), code('UNSUPPORTED_VALUE'));
      assert.throws(() => map.delete(bad as never), code('UNSUPPORTED_VALUE'));
    }
  });

  it('supports delete and clear', () => {
    const map = new ValueMap<string, number>();
    map.set('a', 1).set('b', 2);
    assert.equal(map.delete('a'), true);
    assert.equal(map.delete('a'), false);
    map.clear();
    assert.equal(map.size, 0);
  });
});

describe('Multimap', () => {
  it('keeps duplicate values in insertion order', () => {
    const map = new Multimap<string, number>();
    map.add('a', 1).add('a', 1).add('b', 2);
    assert.deepEqual(map.get('a'), [1, 1]);
    assert.equal(map.size, 2);
    assert.equal(map.valueCount, 3);
  });

  it('returns fresh arrays', () => {
    const map = new Multimap<string, number>();
    map.add('a', 1);
    (map.get('a') as number[]).push(5);
    assert.deepEqual(map.get('a'), [1]);
    assert.deepEqual(map.get('missing'), []);
    for (const [, values] of map) (values as number[]).push(9);
    assert.deepEqual(map.get('a'), [1]);
  });

  it('deletes whole keys and tracks counts', () => {
    const map = new Multimap<object, string>();
    const key = {};
    map.add(key, 'x').add(key, 'y');
    assert.equal(map.delete(key), true);
    assert.equal(map.delete(key), false);
    assert.equal(map.valueCount, 0);
    map.add(key, 'z');
    map.clear();
    assert.equal(map.size, 0);
    assert.equal(map.valueCount, 0);
  });
});

describe('struct iteration helpers', () => {
  it('exposes keys and values', () => {
    const values = new ValueMap<[number, string], number>();
    values.set([1, 'a'], 10);
    assert.deepEqual([...values.values()], [10]);
    const multi = new Multimap<string, number>();
    multi.add('a', 1);
    assert.equal(multi.has('a'), true);
    assert.deepEqual([...multi.keys()], ['a']);
  });
});
