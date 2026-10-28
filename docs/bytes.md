# quorin/bytes

Byte conversion, strict text and binary encodings, and a fast non-cryptographic hash.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

All functions operate on the visible bytes of a `Uint8Array` (respecting `byteOffset` and `byteLength`), accept Node `Buffer` instances, and return new buffers. Views over `SharedArrayBuffer` and detached buffers are rejected.

```ts
import { concatBytes, toBase64, fromBase64, toHex, fastHash, stringToBytes } from 'quorin/bytes';

const bytes = concatBytes(stringToBytes('hello '), stringToBytes('world'));
toHex(bytes);                                   // '68656c6c6f20776f726c64'
toBase64(bytes, { alphabet: 'base64url', omitPadding: true });
fromBase64('aGk', { padding: 'optional' });     // Uint8Array [104, 105]
fastHash(bytes);                                // unsigned 32-bit FNV-1a
```

| Function | Contract |
| --- | --- |
| `concatBytes(...parts)` | One allocation, copies in order. No input means an empty array. |
| `equalsBytes(a, b)` | Length and content comparison. Exits early, so it is **not** constant time. |
| `stringToBytes(text)` | UTF-8 encode. |
| `bytesToString(bytes, { fatal = true, ignoreBOM = false })` | UTF-8 decode. Invalid input throws `INVALID_ENCODING` unless `fatal` is false. |
| `toHex(bytes)` | Lowercase, no prefix. |
| `fromHex(text)` | Either case. Rejects odd length, whitespace, `0x`, and any non-hex character. |
| `toBase64(bytes, { alphabet, omitPadding })` | `'base64'` (default) or `'base64url'`. Padded by default. |
| `fromBase64(text, { alphabet, padding })` | Strict. `padding` is `'required'` (default), `'optional'`, or `'forbidden'`. Rejects whitespace, the other alphabet, bad padding, impossible lengths, and nonzero pad bits. |
| `fastHash(bytes)` | FNV-1a 32-bit, unsigned. Not for security or for hash tables fed by untrusted input. To hash text, call `fastHash(stringToBytes(text))`. |

Malformed hex, base64, and UTF-8 throw a `SyntaxError` with code `INVALID_ENCODING`. Encoder and decoder instances are created lazily on first use.
