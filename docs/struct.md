# quorin/struct

Data structures: a double-ended queue, a map keyed by JSON values, and a map of value lists.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `Deque<T>`

A double-ended queue on a growable ring buffer. End operations are amortized O(1).

```ts
import { Deque } from 'quorin/struct';

const queue = new Deque<string>(); // initialCapacity defaults to 16
queue.push('b');                    // returns the new size
queue.unshift('a');
queue.peek();                       // 'a'
queue.peekBack();                   // 'b'
queue.shift();                      // 'a'
queue.pop();                        // 'b'
queue.size;                         // 0
```

| Member | Description |
| --- | --- |
| `new Deque(initialCapacity?)` | Capacity is rounded up to a power of two (minimum 8, maximum 2^30). |
| `size` | Number of stored values. |
| `push(value)` / `unshift(value)` | Add at the back or front. Returns the new size. |
| `pop()` / `shift()` | Remove from the back or front. Returns `undefined` when empty. |
| `peek()` / `peekBack()` | Read the front or back without removing. |
| `clear()` | Remove everything and reset to the initial capacity. |
| `[Symbol.iterator]()` | Iterate front to back. |

Empty reads return `undefined`. If you store `undefined`, use `size` to tell the difference. Changing the deque while iterating throws an error with code `CONCURRENT_MODIFICATION`. Removed slots are cleared, so the deque does not retain removed values.

## `ValueMap<K extends JsonValue, V>`

A map whose keys are compared by structure instead of identity.

```ts
import { ValueMap } from 'quorin/struct';

const prices = new ValueMap<{ sku: string; size: string }, number>();
prices.set({ sku: 'tee', size: 'M' }, 20);
prices.get({ size: 'M', sku: 'tee' }); // 20, record key order does not matter
```

- Keys must be [JSON values](./object.md#json-values). Unsupported keys throw `UNSUPPORTED_VALUE` in `set`, `get`, `has`, and `delete` alike.
- Record key order is ignored, array order is significant, and `-0` equals `0`.
- Keys are **snapshotted** on `set`. Mutating the original key object afterwards does not affect the map.
- `entries()`, `keys()`, and iteration return detached copies of keys, in insertion order.
- Values are stored by reference.
- Lookup cost grows with key size (the key is traversed and canonicalized).

API: `size`, `set(key, value)` (returns `this`), `get`, `has`, `delete`, `clear`, `entries`, `keys`, `values`.

## `Multimap<K, V>`

A map from each key to an ordered list of values, duplicates included. Keys use native `Map` semantics.

```ts
import { Multimap } from 'quorin/struct';

const tags = new Multimap<string, string>();
tags.add('post-1', 'ts').add('post-1', 'esm');
tags.get('post-1');  // ['ts', 'esm'] (a fresh copy)
tags.get('missing'); // []
tags.size;           // 1 key
tags.valueCount;     // 2 values
```

API: `size`, `valueCount`, `add(key, value)` (returns `this`), `get`, `has`, `delete` (removes the whole key), `clear`, `keys`, `entries`. Arrays returned by `get` and iteration are copies.
