import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepMerge, getPath, SecurityError, setPath, stableStringify } from '../../src/object/index.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

describe('getPath', () => {
  const data = { user: { name: 'Ada', tags: ['a', 'b'], empty: undefined }, 'a.b': 1 };

  it('reads dotted and array paths', () => {
    assert.equal(getPath(data, 'user.name'), 'Ada');
    assert.equal(getPath(data, ['user', 'tags', 1]), 'b');
    assert.equal(getPath(data, ['a.b']), 1);
    assert.equal(getPath(data, []), data);
  });

  it('returns the fallback only for missing paths', () => {
    assert.equal(getPath(data, 'user.missing', 'fallback'), 'fallback');
    assert.equal(getPath(data, 'user.empty', 'fallback'), undefined);
    assert.equal(getPath(data, 'user.name.length', 0), 0);
  });

  it('treats string segments as record keys', () => {
    assert.equal(getPath(data, 'user.tags.0', 'none'), 'none');
  });

  it('never reads inherited properties', () => {
    const child = Object.create({ inherited: { value: 1 } });
    assert.equal(getPath(child, 'inherited.value'), undefined);
    assert.equal(getPath({}, 'toString'), undefined);
  });

  it('rejects accessors instead of invoking them', () => {
    let calls = 0;
    const target = {
      get secret() {
        calls++;
        return 1;
      },
    };
    assert.throws(() => getPath(target, 'secret'), code('UNSUPPORTED_VALUE'));
    assert.equal(calls, 0);
  });

  it('rejects dangerous and malformed segments', () => {
    for (const path of ['__proto__.x', 'a.constructor', ['prototype']]) {
      assert.throws(() => getPath({}, path as string), SecurityError);
    }
    assert.throws(() => getPath({}, 'a..b'), code('INVALID_ARGUMENT'));
    assert.throws(() => getPath({}, ['a', -1]), code('INVALID_ARGUMENT'));
  });
});

describe('setPath', () => {
  it('creates missing branches with null-prototype records and arrays', () => {
    const target: Record<string, unknown> = {};
    setPath(target, ['a', 'b', 0, 'c'], 1);
    assert.equal(Object.getPrototypeOf(target.a), null);
    assert.deepEqual(JSON.parse(JSON.stringify(target)), { a: { b: [{ c: 1 }] } });
  });

  it('updates existing values and appends to arrays', () => {
    const target = { list: [1, 2] };
    setPath(target, ['list', 0], 9);
    setPath(target, ['list', 2], 3);
    assert.deepEqual(target.list, [9, 2, 3]);
    assert.throws(() => setPath(target, ['list', 5], 1), code('INVALID_ARGUMENT'));
  });

  it('does not write through inherited objects', () => {
    const inherited = { nested: { value: 1 } };
    const target = Object.create(inherited) as Record<string, unknown>;
    assert.throws(() => setPath(target, 'nested.value', 2), code('UNSUPPORTED_VALUE'));
    const plain: Record<string, unknown> = {};
    Object.setPrototypeOf(plain, null);
    setPath(plain, 'nested.value', 2);
    assert.equal(inherited.nested.value, 1);
  });

  it('rejects primitive conflicts without changing the input', () => {
    const target = { a: { b: 1 } };
    // @ts-expect-error the typed overload already rejects writing below a number
    assert.throws(() => setPath(target, 'a.b.c', 2), code('UNSUPPORTED_VALUE'));
    assert.deepEqual(target, { a: { b: 1 } });
  });

  it('validates the whole path before writing', () => {
    const target: Record<string, unknown> = {};
    assert.throws(() => setPath(target, ['a', 'b', 3], 1), code('INVALID_ARGUMENT'));
    assert.deepEqual(target, {});
    assert.throws(() => setPath(target, 'x.__proto__.polluted', 1), SecurityError);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('does not invoke inherited setters', () => {
    let called = false;
    const proto = {
      set value(_next: unknown) {
        called = true;
      },
    };
    const target = Object.create(proto);
    assert.throws(() => setPath(target, 'value', 1), code('UNSUPPORTED_VALUE'));
    assert.equal(called, false);
  });

  it('rejects frozen targets and empty paths', () => {
    // @ts-expect-error the typed overload rejects unknown keys
    assert.throws(() => setPath(Object.freeze({}), 'a', 1), code('UNSUPPORTED_VALUE'));
    assert.throws(() => setPath(Object.freeze({ a: 1 }) as { a: number }, 'a', 2), code('UNSUPPORTED_VALUE'));
    assert.throws(() => setPath({}, [], 1), code('INVALID_ARGUMENT'));
  });
});

describe('deepMerge', () => {
  it('merges records recursively and replaces arrays and primitives', () => {
    const left = { a: { x: 1, y: [1, 2] }, keep: true, replace: { deep: 1 } };
    const right = { a: { y: [3], z: 'new' }, replace: null };
    const merged = deepMerge(left, right);
    assert.deepEqual(merged, { a: { x: 1, y: [3], z: 'new' }, keep: true, replace: null });
    assert.notEqual(merged.a.y, right.a.y);
    assert.deepEqual(left, { a: { x: 1, y: [1, 2] }, keep: true, replace: { deep: 1 } });
  });

  it('rejects unsupported values and forbidden keys anywhere', () => {
    assert.throws(() => deepMerge({ a: undefined } as never, {}), code('UNSUPPORTED_VALUE'));
    assert.throws(() => deepMerge({}, { d: new Date() } as never), code('UNSUPPORTED_VALUE'));
    assert.throws(() => deepMerge({}, JSON.parse('{"a":{"__proto__":{"x":1}}}')), SecurityError);
  });

  it('treats shared references by value and rejects cycles', () => {
    const shared = { v: 1 };
    assert.deepEqual(deepMerge({ a: shared, b: shared }, {}), { a: { v: 1 }, b: { v: 1 } });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => deepMerge(cyclic as never, {}), code('UNSUPPORTED_VALUE'));
  });
});

describe('stableStringify', () => {
  it('sorts keys independent of insertion order', () => {
    assert.equal(stableStringify({ b: 1, a: [3, { d: 1, c: 2 }] }), '{"a":[3,{"c":2,"d":1}],"b":1}');
    assert.equal(stableStringify({ 2: 'x', 10: 'y', a: 'z' }), '{"10":"y","2":"x","a":"z"}');
  });

  it('produces valid JSON and normalizes negative zero', () => {
    const text = stableStringify({ n: -0, s: 'quote " and  ', nil: null });
    assert.deepEqual(JSON.parse(text), { n: 0, s: 'quote " and  ', nil: null });
    assert.equal(text.includes('-0'), false);
  });

  it('rejects values outside the JSON domain', () => {
    for (const bad of [[undefined, 1], [, 1], { a: NaN }, { a: 1n }, new Date(), { [Symbol('s')]: 1 }]) {
      assert.throws(() => stableStringify(bad as never), code('UNSUPPORTED_VALUE'));
    }
  });

  it('accepts repeated references and rejects cycles', () => {
    const shared = { v: 1 };
    assert.equal(stableStringify([shared, shared]), '[{"v":1},{"v":1}]');
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    assert.throws(() => stableStringify(cyclic as never), code('UNSUPPORTED_VALUE'));
  });

  it('enforces traversal budgets', () => {
    let deep: unknown = 1;
    for (let index = 0; index < 10; index++) deep = [deep];
    assert.throws(() => stableStringify(deep as never, { maxDepth: 5 }), code('TRAVERSAL_LIMIT'));
    assert.throws(() => stableStringify([[1], [2], [3]], { maxNodes: 2 }), code('TRAVERSAL_LIMIT'));
  });

  it('accepts null-prototype records', () => {
    const record = Object.assign(Object.create(null), { b: 2, a: 1 });
    assert.equal(stableStringify(record), '{"a":1,"b":2}');
  });
});
