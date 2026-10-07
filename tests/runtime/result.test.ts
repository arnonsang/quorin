import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DefectError, err, isDefect, ok, trySafe, trySafeSync } from '../../src/result/index.ts';

describe('SafeResult', () => {
  it('is a real frozen two-element array', () => {
    const result = ok(5);
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 2);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(result.slice(), [null, 5]);
    assert.deepEqual(result.map((value) => value ?? 'x'), ['x', 5]);
  });

  it('supports tuple destructuring and metadata', () => {
    const [error, data] = ok('value');
    assert.equal(error, null);
    assert.equal(data, 'value');
    const failure = err('boom');
    assert.equal(failure.ok, false);
    assert.equal(failure.error, 'boom');
    assert.equal(failure.data, null);
    assert.equal(failure[0], 'boom');
  });

  it('keeps falsy errors distinguishable through ok', () => {
    const failure = err(null);
    assert.equal(failure.ok, false);
    assert.equal(failure.error, null);
  });

  it('preserves undefined payloads', () => {
    const result = ok(undefined);
    assert.equal(result.ok, true);
    assert.equal(result.data, undefined);
  });

  it('serializes to the tuple form', () => {
    assert.equal(JSON.stringify(ok({ a: 1 })), '[null,{"a":1}]');
    assert.equal(JSON.stringify(err('e')), '["e",null]');
  });

  it('offers unwrapOr and mapData', () => {
    assert.equal(ok(2).unwrapOr(0), 2);
    assert.equal(err('x').unwrapOr(0), 0);
    const mapped = ok(2).mapData((value) => value * 3);
    assert.equal(mapped.ok && mapped.data, 6);
    const failure = err('x');
    assert.equal(failure.mapData(() => 1), failure);
  });

  it('propagates mapData exceptions', () => {
    assert.throws(() => ok(1).mapData(() => {
      throw new Error('mapper');
    }), /mapper/);
  });
});

describe('trySafeSync', () => {
  it('captures thrown values unchanged', () => {
    const thrown = { reason: 'x' };
    const result = trySafeSync(() => {
      throw thrown;
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, thrown);
  });

  it('maps errors when a mapper is supplied', () => {
    const result = trySafeSync(() => {
      throw new Error('raw');
    }, { mapError: (raw) => `mapped:${(raw as Error).message}` });
    assert.equal(result.error, 'mapped:raw');
  });

  it('rethrows DefectError and calls onDefect', () => {
    const seen: unknown[] = [];
    const defect = new DefectError('bug');
    assert.throws(() => trySafeSync(() => {
      throw defect;
    }, { onDefect: (raw) => seen.push(raw) }), (error) => error === defect);
    assert.deepEqual(seen, [defect]);
  });

  it('does not treat TypeError or SyntaxError as defects', () => {
    const result = trySafeSync(() => JSON.parse('{'));
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof SyntaxError);
  });

  it('supports a custom defect classifier and catchDefects', () => {
    const classifyDefect = (raw: unknown) => raw instanceof RangeError;
    assert.throws(() => trySafeSync(() => {
      throw new RangeError('r');
    }, { classifyDefect }), RangeError);
    const caught = trySafeSync(() => {
      throw new DefectError('d');
    }, { catchDefects: true });
    assert.ok(isDefect(caught.error));
  });

  it('propagates mapError failures', () => {
    assert.throws(() => trySafeSync(() => {
      throw 1;
    }, {
      mapError: () => {
        throw new Error('mapper failed');
      },
    }), /mapper failed/);
  });
});

describe('trySafe', () => {
  it('captures synchronous throws and rejections', async () => {
    const sync = await trySafe(() => {
      throw new TypeError('network');
    });
    assert.ok(sync.error instanceof TypeError);
    const rejected = await trySafe(() => Promise.reject('no'));
    assert.equal(rejected.error, 'no');
  });

  it('resolves values and thenables', async () => {
    const thenable = { then: (resolve: (value: number) => void) => resolve(4) } as PromiseLike<number>;
    const result = await trySafe(() => thenable);
    assert.equal(result.ok && result.data, 4);
  });

  it('rejects defects', async () => {
    await assert.rejects(trySafe(async () => {
      throw new DefectError('bug');
    }), DefectError);
  });

  it('rejects invalid configuration', async () => {
    await assert.rejects(trySafe(1 as unknown as () => number), { code: 'INVALID_ARGUMENT' });
  });
});
