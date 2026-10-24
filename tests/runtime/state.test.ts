import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLONE_SYMBOL, isEqual, redact, safeClone, StateError, type CloneContext } from '../../src/state/index.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

describe('safeClone', () => {
  it('clones supported built-ins', () => {
    const buffer = new ArrayBuffer(8);
    const source = {
      date: new Date(5),
      regexp: Object.assign(/a/g, { lastIndex: 2 }),
      map: new Map<unknown, unknown>([[{ k: 1 }, new Set([1n])]]),
      bytes: new Uint8Array(buffer, 2, 4),
      view: new DataView(buffer, 1, 2),
      nothing: undefined,
    };
    const copy = safeClone(source);
    assert.notEqual(copy.date, source.date);
    assert.equal(copy.date.getTime(), 5);
    assert.equal(copy.regexp.lastIndex, 2);
    assert.equal(copy.regexp.flags, 'g');
    assert.equal(isEqual(copy, source), true);
    assert.equal(copy.bytes.byteOffset, 2);
    assert.equal(copy.bytes.length, 4);
    assert.equal(copy.bytes.buffer, copy.view.buffer);
    assert.notEqual(copy.bytes.buffer, buffer);
    assert.equal(Object.hasOwn(copy, 'nothing'), true);
  });

  it('preserves cycles, aliases, holes, symbol keys, and descriptors', () => {
    const symbol = Symbol('key');
    const shared = { v: 1 };
    const source: Record<PropertyKey, unknown> = { a: shared, b: shared, [symbol]: 'sym' };
    source.self = source;
    Object.defineProperty(source, 'hidden', { value: 1, enumerable: false });
    const sparse = [1, , 3];
    source.sparse = sparse;
    const copy = safeClone(source);
    assert.equal(copy.self, copy);
    assert.equal(copy.a, copy.b);
    assert.notEqual(copy.a, shared);
    assert.equal(copy[symbol], 'sym');
    assert.equal(Object.getOwnPropertyDescriptor(copy, 'hidden')?.enumerable, false);
    assert.equal(1 in (copy.sparse as unknown[]), false);
  });

  it('restores non-extensibility after copying', () => {
    const copy = safeClone(Object.freeze({ a: { b: 1 } }));
    assert.equal(Object.isFrozen(copy), true);
    assert.equal(Object.isFrozen(copy.a), false);
    const frozenArray = safeClone(Object.freeze([1, 2]));
    assert.equal(Object.isFrozen(frozenArray), true);
  });

  it('rejects class instances without a hook', () => {
    class Account {
      #balance = 1;
      balance(): number {
        return this.#balance;
      }
    }
    assert.throws(() => safeClone({ account: new Account() }), StateError);
  });

  it('uses CLONE_SYMBOL hooks for private state and cycles', () => {
    class Node {
      #secret: number;
      next: Node | null = null;
      constructor(secret: number) {
        this.#secret = secret;
      }
      secret(): number {
        return this.#secret;
      }
      [CLONE_SYMBOL](context: CloneContext): Node {
        const copy = context.register(this, new Node(this.#secret));
        copy.next = context.clone(this.next);
        return copy;
      }
    }
    const node = new Node(7);
    node.next = node;
    const copy = safeClone(node);
    assert.ok(copy instanceof Node);
    assert.notEqual(copy, node);
    assert.equal(copy.secret(), 7);
    assert.equal(copy.next, copy);
  });

  it('rejects conflicting hook registrations', () => {
    const value = {
      [CLONE_SYMBOL](context: CloneContext) {
        context.register(this, {});
        return {};
      },
    };
    Object.setPrototypeOf(value, Object.create(null));
    assert.throws(() => safeClone(value), code('UNSUPPORTED_VALUE'));
  });

  it('rejects unsupported values by default and can share them by reference', () => {
    const fn = () => 1;
    const holder = { fn, accessor: { get x() { return 1; } } };
    assert.throws(() => safeClone(holder), code('UNSUPPORTED_VALUE'));
    const copy = safeClone(holder, { unsupported: 'reference' });
    assert.equal(copy.fn, fn);
    assert.equal(copy.accessor, holder.accessor);
  });

  it('rejects built-ins with custom properties, subclasses, and fake brands', () => {
    assert.throws(() => safeClone(Object.assign(new Date(), { extra: 1 })), code('UNSUPPORTED_VALUE'));
    class MyMap extends Map {}
    assert.throws(() => safeClone(new MyMap()), code('UNSUPPORTED_VALUE'));
    assert.throws(() => safeClone(Object.create(Date.prototype)), code('UNSUPPORTED_VALUE'));
    assert.throws(() => safeClone(new SharedArrayBuffer(1)), code('UNSUPPORTED_VALUE'));
    assert.throws(() => safeClone(Promise.resolve()), code('UNSUPPORTED_VALUE'));
  });

  it('enforces traversal budgets', () => {
    let deep: unknown = {};
    for (let index = 0; index < 20; index++) deep = { deep };
    assert.throws(() => safeClone(deep, { maxDepth: 10 }), code('TRAVERSAL_LIMIT'));
  });
});

describe('isEqual', () => {
  it('uses Object.is for primitives', () => {
    assert.equal(isEqual(NaN, NaN), true);
    assert.equal(isEqual(0, -0), false);
    assert.equal(isEqual('a', 'a'), true);
  });

  it('compares plain graphs, descriptors, and holes', () => {
    assert.equal(isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
    assert.equal(isEqual([1, , 3], [1, undefined, 3]), false);
    const hidden = Object.defineProperty({}, 'a', { value: 1, enumerable: false });
    assert.equal(isEqual(hidden, { a: 1 }), false);
    assert.equal(isEqual(Object.create(null), {}), false);
  });

  it('compares Map and Set contents in insertion order', () => {
    assert.equal(isEqual(new Map([[1, 'a']]), new Map([[1, 'b']])), false);
    assert.equal(isEqual(new Set([1, 2]), new Set([1, 3])), false);
    assert.equal(isEqual(new Set([1, 2]), new Set([1, 2])), true);
    assert.equal(isEqual(new Set([1, 2]), new Set([2, 1])), false);
  });

  it('compares dates, regular expressions, and bytes', () => {
    assert.equal(isEqual(new Date(1), new Date(1)), true);
    assert.equal(isEqual(new Date(NaN), new Date(NaN)), true);
    assert.equal(isEqual(/a/g, /a/i), false);
    assert.equal(isEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
    assert.equal(isEqual(new Uint8Array([1, 2]), new Int8Array([1, 2])), false);
    assert.equal(isEqual(new ArrayBuffer(2), new ArrayBuffer(3)), false);
  });

  it('treats alias topology as significant', () => {
    const child = { v: 1 };
    assert.equal(isEqual({ a: child, b: child }, { a: { v: 1 }, b: { v: 1 } }), false);
    const x: Record<string, unknown> = {};
    x.self = x;
    const y: Record<string, unknown> = {};
    y.self = y;
    assert.equal(isEqual(x, y), true);
  });

  it('compares unsupported objects by reference', () => {
    class Point {
      readonly x: number;
      constructor(x: number) {
        this.x = x;
      }
    }
    assert.equal(isEqual(new Point(1), new Point(1)), false);
    const point = new Point(1);
    assert.equal(isEqual({ p: point }, { p: point }), true);
  });

  it('does not invoke getters', () => {
    let calls = 0;
    const getter = () => {
      calls++;
      return 1;
    };
    const a = Object.defineProperty({}, 'x', { get: getter, enumerable: true });
    const b = Object.defineProperty({}, 'x', { get: getter, enumerable: true });
    assert.equal(isEqual(a, b), true);
    assert.equal(calls, 0);
  });

  it('rejects shared buffers and custom properties on built-ins', () => {
    assert.throws(() => isEqual(new SharedArrayBuffer(1), new SharedArrayBuffer(1)), StateError);
    assert.throws(() => isEqual(Object.assign(new Date(1), { x: 1 }), new Date(1)), StateError);
  });

  it('is symmetric on random graphs', () => {
    const samples = [{ a: 1 }, { a: [1, 2] }, [1, { b: null }], new Map([[1, 2]]), { a: 1, b: 2 }];
    for (const a of samples) for (const b of samples) assert.equal(isEqual(a, b), isEqual(b, a));
    for (const a of samples) assert.equal(isEqual(a, safeClone(a)), true);
  });
});

describe('redact', () => {
  it('masks default secret keys without mutating the input', () => {
    const input = { user: 'ada', password: 'hunter2', nested: { apiKey: 'k', Authorization: 'Bearer x' } };
    const snapshot = JSON.stringify(input);
    const output = redact(input);
    assert.deepEqual(output, { user: 'ada', password: '[REDACTED]', nested: { apiKey: '[REDACTED]', Authorization: '[REDACTED]' } });
    assert.equal(JSON.stringify(input), snapshot);
    const text = JSON.stringify(output);
    for (const secret of ['hunter2', 'Bearer x']) assert.equal(text.includes(secret), false);
  });

  it('masks explicit paths and custom keys', () => {
    const output = redact({ users: [{ email: 'a@b.c', name: 'A' }], ssn: '1' }, { paths: [['users', 0, 'email']], keys: ['SSN'] });
    assert.deepEqual(output, { users: [{ email: '[REDACTED]', name: 'A' }], ssn: '[REDACTED]' });
  });

  it('does not let global regular expressions skip matches', () => {
    const output = redact({ token1: 'a', token2: 'b' }, { keys: [/token/g], defaultKeys: false });
    assert.deepEqual(output, { token1: '[REDACTED]', token2: '[REDACTED]' });
  });

  it('handles cycles, repeats, and special values', () => {
    const shared = { v: 1 };
    const input: Record<string, unknown> = { shared, again: shared, big: 10n, inf: Infinity, fn() {}, when: new Date(0), bad: new Date(NaN) };
    input.self = input;
    assert.deepEqual(redact(input), {
      shared: { v: 1 },
      again: '[REFERENCE]',
      big: '10n',
      inf: 'Infinity',
      fn: '[FUNCTION]',
      when: '1970-01-01T00:00:00.000Z',
      bad: '[INVALID DATE]',
      self: '[CIRCULAR]',
    });
  });

  it('projects errors, collections, buffers, and accessors safely', () => {
    let calls = 0;
    const input = {
      error: new TypeError('contains secret'),
      map: new Map([['token', 'x'], ['plain', 'y']]),
      set: new Set([1]),
      bytes: new Uint8Array([1, 2, 3]),
      get computed() {
        calls++;
        return 1;
      },
      weak: new WeakMap(),
      [Symbol('s')]: 'hidden',
    };
    const output = redact(input);
    assert.deepEqual(output, {
      error: { name: 'TypeError', error: '[ERROR]' },
      map: [['token', '[REDACTED]'], ['plain', 'y']],
      set: [1],
      bytes: { type: 'Uint8Array', byteLength: 3 },
      computed: '[ACCESSOR]',
      weak: '[WEAKMAP]',
      '[Symbol(s)]': '[SYMBOL KEY]',
    });
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(output).includes('contains secret'), false);
  });

  it('truncates at traversal limits', () => {
    assert.deepEqual(redact({ a: { b: { c: 1 } } }, { maxDepth: 2 }), { a: { b: '[TRUNCATED]' } });
  });

  it('keeps __proto__ keys as data', () => {
    const output = redact(JSON.parse('{"__proto__":{"x":1}}')) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(output), Object.prototype);
    assert.deepEqual(Object.keys(output), ['__proto__']);
  });
});

describe('state edge cases', () => {
  it('validates clone options and hook results', () => {
    assert.throws(() => safeClone({}, { unsupported: 'copy' as never }), code('UNSUPPORTED_VALUE'));
    const badHook = Object.create({ [CLONE_SYMBOL]: () => 1 });
    assert.throws(() => safeClone(badHook), code('UNSUPPORTED_VALUE'));
    const symbolValue = Symbol('v');
    assert.equal(safeClone(symbolValue, { unsupported: 'reference' }), symbolValue);
  });

  it('clones resizable buffers and rejects detached ones', () => {
    const Resizable = ArrayBuffer as unknown as new (length: number, options: { maxByteLength: number }) => ArrayBuffer & { resizable: boolean; maxByteLength: number };
    const buffer = new Resizable(2, { maxByteLength: 8 });
    new Uint8Array(buffer).set([1, 2]);
    const copy = safeClone(buffer);
    assert.equal(copy.resizable, true);
    assert.equal(copy.maxByteLength, 8);
    assert.deepEqual([...new Uint8Array(copy)], [1, 2]);
    const detached = new ArrayBuffer(4);
    const view = new Uint8Array(detached);
    structuredClone(detached, { transfer: [detached] });
    assert.throws(() => safeClone(detached), code('UNSUPPORTED_VALUE'));
    assert.throws(() => isEqual(view, new Uint8Array(4)), code('UNSUPPORTED_VALUE'));
  });

  it('compares DataViews and enforces equality budgets', () => {
    assert.equal(isEqual(new DataView(new ArrayBuffer(4), 1), new DataView(new ArrayBuffer(4), 1)), true);
    assert.equal(isEqual(new DataView(new ArrayBuffer(4), 1), new DataView(new ArrayBuffer(4), 2)), false);
    assert.throws(() => isEqual({ a: { b: 1 } }, { a: { b: 1 } }, { maxDepth: 1 }), code('TRAVERSAL_LIMIT'));
    assert.equal(isEqual({ a: 1 }, [1]), false);
    assert.equal(isEqual({ a: 1 }, { b: 1 }), false);
    assert.equal(isEqual({ a: 1 }, { a: 1, b: 2 }), false);
    assert.equal(isEqual(new Map([[1, 2]]), new Map([[1, 2], [3, 4]])), false);
    assert.equal(isEqual(new Set([1]), new Set([1, 2])), false);
    assert.equal(isEqual(/a/g, /a/g), true);
  });

  it('projects remaining value kinds in redact', () => {
    const error = new Error('x');
    Object.defineProperty(error, 'name', { value: 42 });
    const named = Object.create(null) as Error;
    const output = redact({
      list: [undefined, Symbol('s'), , 1],
      pattern: /a+/gi,
      buffer: new ArrayBuffer(3),
      view: new DataView(new ArrayBuffer(2)),
      weakSet: new WeakSet(),
      weakRef: new WeakRef({}),
      promise: Promise.resolve(),
      instance: new (class Thing {})(),
      error,
      map: new Map<unknown, unknown>([[{ k: 1 }, 'object key']]),
      accessorArray: Object.defineProperty([0], 0, { get: () => 1, enumerable: true }),
      guarded: Object.defineProperty({}, 'password', { get: () => 'x', enumerable: true }),
      hidden: Object.defineProperty({}, 'h', { value: 1, enumerable: false }),
    });
    assert.deepEqual(output, {
      list: [null, '[SYMBOL]', null, 1],
      pattern: '/a+/gi',
      buffer: { type: 'ArrayBuffer', byteLength: 3 },
      view: { type: 'DataView', byteLength: 2 },
      weakSet: '[WEAKSET]',
      weakRef: '[WEAKREF]',
      promise: '[PROMISE]',
      instance: '[OBJECT]',
      error: { name: 'Error', error: '[ERROR]' },
      map: [[{ k: 1 }, 'object key']],
      accessorArray: ['[ACCESSOR]'],
      guarded: { password: '[REDACTED]' },
      hidden: {},
    });
    assert.equal(named instanceof Error, false);
  });

  it('uses custom error serializers, masks, and validates options', () => {
    const output = redact({ error: new RangeError('boom'), token: 't' }, {
      serializeError: (error) => ({ message: error.message }),
      mask: '***',
    });
    assert.deepEqual(output, { error: { message: 'boom' }, token: '***' });
    assert.throws(() => redact({}, { keys: 'token' as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => redact({}, { keys: [1 as never] }), code('INVALID_ARGUMENT'));
    assert.throws(() => redact({}, { paths: 'a' as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => redact({}, { mask: 1 as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => redact({}, { serializeError: 1 as never }), code('INVALID_ARGUMENT'));
    assert.equal(redact('plain'), 'plain');
    assert.deepEqual(redact({ password: 'x' }, { defaultKeys: false }), { password: 'x' });
  });

  it('falls back to Error when no name is found', () => {
    const error = Object.setPrototypeOf(new Error('x'), null) as Error;
    Object.setPrototypeOf(error, Object.create(Error.prototype, { name: { get: () => 'Getter' } }));
    assert.deepEqual(redact(error), { name: 'Error', error: '[ERROR]' });
  });
});
