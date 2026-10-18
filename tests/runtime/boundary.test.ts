import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type } from 'arktype';
import * as v from 'valibot';
import { z } from 'zod';
import { BoundaryValidationError, defineBoundary, formatIssues, parseEnv } from '../../src/boundary/index.ts';
import { DefectError } from '../../src/result/index.ts';
import { fakeSchema } from '../helpers/schema.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

describe('parseEnv', () => {
  it('returns the transformed output of an injected source', async () => {
    const schema = z.object({ PORT: z.coerce.number().int(), MODE: z.enum(['dev', 'prod']).default('dev') });
    const source = { PORT: '8080' };
    const env = await parseEnv(schema, source);
    assert.deepEqual(env, { PORT: 8080, MODE: 'dev' });
    assert.deepEqual(source, { PORT: '8080' });
  });

  it('rejects with BoundaryValidationError without leaking values', async () => {
    const schema = z.object({ SECRET: z.string().min(100) });
    await assert.rejects(parseEnv(schema, { SECRET: 'super-secret-value' }), (error) => {
      assert.ok(error instanceof BoundaryValidationError);
      assert.equal(error.vendor, 'zod');
      assert.equal(error.issues.length, 1);
      assert.equal(error.message.includes('super-secret-value'), false);
      return true;
    });
  });

  it('supports asynchronous validators and propagates validator errors', async () => {
    const asyncSchema = fakeSchema(async (value) => ({ value: Object.keys(value as object).length }));
    assert.equal(await parseEnv(asyncSchema, { A: '1', B: '2' }), 2);
    const broken = fakeSchema(() => {
      throw new RangeError('validator bug');
    });
    await assert.rejects(parseEnv(broken, {}), RangeError);
  });

  it('validates its arguments', async () => {
    await assert.rejects(parseEnv({} as never, {}), code('INVALID_ARGUMENT'));
    await assert.rejects(parseEnv(fakeSchema(() => ({ value: 1 })), null as never), code('INVALID_ARGUMENT'));
    const wrongVersion = { '~standard': { version: 2, vendor: 'x', validate: () => ({ value: 1 }) } };
    await assert.rejects(parseEnv(wrongVersion as never, {}), code('INVALID_ARGUMENT'));
    const noValidate = { '~standard': { version: 1, vendor: 'x' } };
    await assert.rejects(parseEnv(noValidate as never, {}), code('INVALID_ARGUMENT'));
    await assert.rejects(parseEnv(fakeSchema(() => null as never), {}), code('INVALID_ARGUMENT'));
  });
});

describe('defineBoundary', () => {
  it('validates before invoking the handler', async () => {
    let calls = 0;
    const boundary = defineBoundary(v.object({ id: v.pipe(v.string(), v.transform(Number)) }), (input) => {
      calls++;
      return input.id * 2;
    });
    const success = await boundary({ id: '21' });
    assert.equal(success.ok && success.data, 42);
    const failure = await boundary({ id: 5 });
    assert.equal(failure.ok, false);
    assert.ok(failure.error instanceof BoundaryValidationError);
    assert.equal(calls, 1);
  });

  it('treats an empty issues array as failure', async () => {
    const boundary = defineBoundary(fakeSchema(() => ({ issues: [] })), () => 1);
    const result = await boundary('x');
    assert.equal(result.ok, false);
    assert.equal((result.error as BoundaryValidationError).issues.length, 0);
  });

  it('captures handler failures and maps them', async () => {
    const boundary = defineBoundary(type('string'), () => {
      throw new Error('handler');
    }, { mapError: (raw) => ({ wrapped: (raw as Error).message }) });
    const result = await boundary('ok');
    assert.deepEqual(result.error, { wrapped: 'handler' });
  });

  it('rethrows defects and validator crashes', async () => {
    const defect = defineBoundary(fakeSchema((value) => ({ value })), () => {
      throw new DefectError('bug');
    });
    await assert.rejects(defect(1), DefectError);
    const crash = defineBoundary(fakeSchema(() => Promise.reject(new Error('crash'))), () => 1);
    await assert.rejects(crash(1), /crash/);
  });

  it('validates configuration eagerly', () => {
    assert.throws(() => defineBoundary({} as never, () => 1), code('INVALID_ARGUMENT'));
    assert.throws(() => defineBoundary(fakeSchema((value) => ({ value })), 1 as never), code('INVALID_ARGUMENT'));
    assert.throws(() => defineBoundary(fakeSchema((value) => ({ value })), () => 1, { mapError: 1 as never }), code('INVALID_ARGUMENT'));
  });
});

describe('formatIssues', () => {
  it('groups messages by typed paths without collisions', () => {
    const symbol = Symbol('s');
    const groups = formatIssues([
      { message: 'root' },
      { message: 'a', path: ['a.b'] },
      { message: 'b', path: ['a', 'b'] },
      { message: 'c', path: [{ key: 'a' }, 'b'] },
      { message: 'd', path: [0] },
      { message: 'e', path: ['0'] },
      { message: 'f', path: [symbol] },
      { message: 'g', path: ['__proto__'] },
    ]);
    assert.deepEqual(groups.map((group) => [group.path, group.messages]), [
      [[], ['root']],
      [['a.b'], ['a']],
      [['a', 'b'], ['b', 'c']],
      [[0], ['d']],
      [['0'], ['e']],
      [[symbol], ['f']],
      [['__proto__'], ['g']],
    ]);
  });

  it('accepts a BoundaryValidationError from a real validator', async () => {
    const boundary = defineBoundary(z.object({ user: z.object({ age: z.number(), name: z.string() }) }), () => 1);
    const result = await boundary({ user: { age: 'x' } });
    const groups = formatIssues(result.error as BoundaryValidationError);
    assert.deepEqual(groups.map((group) => group.path), [['user', 'age'], ['user', 'name']]);
    assert.throws(() => formatIssues('x' as never), code('INVALID_ARGUMENT'));
  });
});
