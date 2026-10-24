import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bytesToString,
  concatBytes,
  equalsBytes,
  fastHash,
  fromBase64,
  fromHex,
  stringToBytes,
  toBase64,
  toHex,
} from '../../src/bytes/index.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

describe('concatBytes', () => {
  it('concatenates in order into a new buffer', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    const out = concatBytes(a, b);
    assert.deepEqual([...out], [1, 2, 3]);
    out[0] = 9;
    assert.equal(a[0], 1);
  });

  it('returns an empty array for no input', () => {
    assert.equal(concatBytes().byteLength, 0);
  });

  it('respects byteOffset and byteLength of views', () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4]);
    assert.deepEqual([...concatBytes(backing.subarray(1, 3), backing.subarray(4))], [1, 2, 4]);
  });

  it('rejects non-byte input', () => {
    assert.throws(() => concatBytes([1] as unknown as Uint8Array), code('INVALID_ARGUMENT'));
  });
});

describe('equalsBytes', () => {
  it('compares length and content', () => {
    assert.equal(equalsBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
    assert.equal(equalsBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
    assert.equal(equalsBytes(new Uint8Array([1]), new Uint8Array([1, 0])), false);
  });
});

describe('text encoding', () => {
  it('round trips Thai and emoji text', () => {
    const text = 'สวัสดี 👋 senu';
    assert.equal(bytesToString(stringToBytes(text)), text);
  });

  it('rejects invalid UTF-8 by default', () => {
    assert.throws(() => bytesToString(new Uint8Array([0xff, 0xfe])), code('INVALID_ENCODING'));
  });

  it('can replace invalid sequences when fatal is false', () => {
    assert.equal(bytesToString(new Uint8Array([0x61, 0xff]), { fatal: false }), 'a�');
  });

  it('strips the BOM unless ignoreBOM is set', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    assert.equal(bytesToString(bytes), 'a');
    assert.equal(bytesToString(bytes, { ignoreBOM: true }), '﻿a');
  });
});

describe('hex', () => {
  it('encodes every byte value in lowercase', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    const hex = toHex(all);
    assert.equal(hex.length, 512);
    assert.equal(hex.slice(0, 6), '000102');
    assert.equal(hex.slice(-2), 'ff');
    assert.deepEqual(fromHex(hex), all);
  });

  it('accepts upper case', () => {
    assert.deepEqual([...fromHex('ABcd')], [0xab, 0xcd]);
  });

  for (const bad of ['gg', '1g', 'abc', ' 0a', '0x0a', 'a\n']) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => fromHex(bad), code('INVALID_ENCODING'));
    });
  }
});

describe('base64', () => {
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];
  for (const [plain, encoded] of vectors) {
    it(`matches RFC 4648 vector ${JSON.stringify(plain)}`, () => {
      assert.equal(toBase64(stringToBytes(plain)), encoded);
      assert.equal(bytesToString(fromBase64(encoded)), plain);
    });
  }

  it('supports base64url with optional padding', () => {
    const bytes = new Uint8Array([0xfb, 0xff]);
    assert.equal(toBase64(bytes), '+/8=');
    assert.equal(toBase64(bytes, { alphabet: 'base64url' }), '-_8=');
    assert.equal(toBase64(bytes, { alphabet: 'base64url', omitPadding: true }), '-_8');
    assert.deepEqual(fromBase64('-_8', { alphabet: 'base64url', padding: 'optional' }), bytes);
  });

  it('requires padding unless explicitly relaxed', () => {
    assert.throws(() => fromBase64('-_8', { alphabet: 'base64url' }), code('INVALID_ENCODING'));
    assert.throws(() => fromBase64('-_8=', { alphabet: 'base64url', padding: 'forbidden' }), code('INVALID_ENCODING'));
  });

  for (const bad of ['Zg', 'Zg=', 'Z===', 'Zm9v\n', 'Zm 9v', 'Zh==', 'Zm9=', '-_8=', 'A', 'Zg==Zg==']) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => fromBase64(bad), code('INVALID_ENCODING'));
    });
  }

  it('round trips large and sliced input', () => {
    const big = Uint8Array.from({ length: 100_003 }, (_, index) => (index * 31) & 255);
    assert.deepEqual(fromBase64(toBase64(big)), big);
    const view = big.subarray(7, 1000);
    assert.deepEqual(fromBase64(toBase64(view, { alphabet: 'base64url' }), { alphabet: 'base64url' }), view);
  });
});

describe('fastHash', () => {
  it('matches FNV-1a 32-bit vectors', () => {
    assert.equal(fastHash(new Uint8Array()), 0x811c9dc5);
    assert.equal(fastHash(stringToBytes('a')), 0xe40c292c);
    assert.equal(fastHash(stringToBytes('foobar')), 0xbf9cf968);
  });

  it('returns an unsigned 32-bit integer', () => {
    const value = fastHash(stringToBytes('senu'));
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff);
  });

  it('accepts bytes only', () => {
    assert.throws(() => fastHash('text' as unknown as Uint8Array), code('INVALID_ARGUMENT'));
  });
});

describe('buffer policy', () => {
  it('rejects SharedArrayBuffer views', () => {
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    assert.throws(() => toHex(shared), code('UNSUPPORTED_VALUE'));
  });

  it('rejects detached buffers', () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    assert.throws(() => toHex(view), code('UNSUPPORTED_VALUE'));
  });
});

describe('bytes edge cases', () => {
  it('validates options and argument types', () => {
    assert.throws(() => toBase64(new Uint8Array(), { alphabet: 'hex' as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => fromBase64('', { padding: 'sometimes' as never }), code('INVALID_ARGUMENT'));
    assert.throws(() => fromBase64(1 as never), code('INVALID_ARGUMENT'));
    assert.throws(() => fromHex(1 as never), code('INVALID_ARGUMENT'));
    assert.throws(() => stringToBytes(1 as never), code('INVALID_ARGUMENT'));
    assert.throws(() => toBase64(new Uint8Array(), null as never), code('INVALID_ARGUMENT'));
  });

  it('decodes non-ASCII characters as invalid base64', () => {
    assert.throws(() => fromBase64('Zm9vÿ==='), code('INVALID_ENCODING'));
    assert.throws(() => fromBase64('ZmA'), code('INVALID_ENCODING'));
  });

  it('accepts unpadded standard base64 when allowed', () => {
    assert.equal(bytesToString(fromBase64('Zm9vYg', { padding: 'optional' })), 'foob');
    assert.equal(bytesToString(fromBase64('Zm9vYmE', { padding: 'forbidden' })), 'fooba');
    assert.equal(toBase64(stringToBytes('fooba'), { omitPadding: true }), 'Zm9vYmE');
  });

  it('accepts Buffer instances', () => {
    assert.equal(toHex(Buffer.from('hi')), '6869');
  });
});
