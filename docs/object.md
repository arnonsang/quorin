# quorin/object

Safe path access, non-mutating merges, and deterministic JSON for plain data.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## Paths

A path is either an array of segments or a dotted string.

- Array form: `['users', 0, 'name']`. Number segments address array indexes, string segments address record keys.
- Dotted form: `'users.name'`. Every piece is a string segment. Empty pieces are rejected. There is no bracket syntax or escaping, so the literal key `a.b` must be written as `['a.b']`.
- `__proto__`, `constructor`, and `prototype` are rejected anywhere in a path with `SecurityError` (code `UNSAFE_PATH`).

## `getPath(target, path, fallback?)`

```ts
import { getPath } from 'quorin/object';

const config = { server: { port: 8080, host: undefined }, tags: ['a'] };

getPath(config, 'server.port');        // 8080, typed as number
getPath(config, ['tags', 0]);          // 'a'
getPath(config, 'server.timeout', 30); // 30 (missing, so the fallback is used)
getPath(config, 'server.host', 'x');   // undefined (present, so no fallback)
```

Reads only **own data properties**. Inherited properties count as missing, and accessors throw `UNSUPPORTED_VALUE` instead of being invoked. The return type is inferred for literal paths up to eight segments; dynamic paths return `unknown`.

## `setPath(target, path, value)`

```ts
import { setPath } from 'quorin/object';

const settings: Record<string, unknown> = {};
setPath(settings, ['theme', 'colors', 0], '#fff');
// settings.theme is a null-prototype record, settings.theme.colors is ['#fff']
```

- Mutates a plain record or dense array that you own.
- Creates missing branches: null-prototype records for string segments, arrays for number segments.
- Updates an existing array index or appends at `length`. Holes are rejected.
- Refuses to replace an existing primitive branch, to walk through class instances, to invoke setters, or to write read-only or non-extensible targets.
- Validates the whole path first and performs a single write, so a failure leaves the input unchanged.
- For literal paths the value type is checked against the location.

## `deepMerge(left, right)`

```ts
import { deepMerge } from 'quorin/object';

const merged = deepMerge(
  { db: { host: 'localhost', port: 5432 }, flags: ['a'] },
  { db: { port: 6543 }, flags: ['b'] },
);
// { db: { host: 'localhost', port: 6543 }, flags: ['b'] }
```

Returns a newly allocated graph and never mutates its inputs. Records merge recursively; arrays and primitives from `right` replace those from `left` (arrays are cloned, not concatenated). A `null` on the right replaces a record. Both inputs must be JSON records. Unsupported values and forbidden keys anywhere in either input throw. The result type reflects replaced properties correctly instead of using a plain intersection.

## `stableStringify(value, options?)`

```ts
import { stableStringify } from 'quorin/object';

stableStringify({ b: 1, a: [2, { d: 1, c: 0 }] });
// '{"a":[2,{"c":0,"d":1}],"b":1}'
```

Valid JSON with record keys sorted by UTF-16 code unit order. Array order is kept, `-0` becomes `0`, and Unicode is not normalized. Repeated references are serialized by value; cycles throw. This is a stable format for cache keys and fingerprints within its contract, not RFC 8785 or a signature protocol.

## JSON values

`JsonValue` is `null`, booleans, strings, finite numbers, dense arrays of JSON values, and plain records (ordinary or null prototype) whose own enumerable string keys hold JSON values. Accessors, symbols, non-enumerable properties, sparse arrays, functions, `undefined`, `bigint`, cycles, and custom prototypes are outside the domain and are rejected at runtime.

Traversal is bounded. Functions that walk graphs accept `{ maxDepth, maxNodes }` (defaults 128 and 100000) and throw `TRAVERSAL_LIMIT` when exceeded.
