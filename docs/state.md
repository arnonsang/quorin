# quorin/state

Deep copies, structural equality, and log-safe projections of object graphs.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `safeClone(value, options?)`

```ts
import { safeClone, CLONE_SYMBOL, type CloneContext } from 'quorin/state';

const copy = safeClone({ when: new Date(), tags: new Set(['a']), bytes: new Uint8Array(4) });
```

Supported: primitives (including `bigint`), plain records, arrays, `Date`, `RegExp`, `Map`, `Set`, `ArrayBuffer` (including resizable), `DataView`, and typed arrays. Cycles and aliases are preserved, as are sparse holes, symbol keys, property descriptors, `RegExp.lastIndex`, view offsets, and non-extensibility.

Unsupported values throw `StateError` (`UNSUPPORTED_VALUE`): functions, symbol values, accessors, class instances without a clone hook, built-in subclasses, built-ins with extra own properties, promises, weak collections, shared or detached buffers, and objects from other realms. Pass `{ unsupported: 'reference' }` to share such values by reference instead; the result is then not an isolation boundary.

Classes opt in with a clone hook, which lets them rebuild private fields and keep cycles intact:

```ts
class TreeNode {
  #id: string;
  parent: TreeNode | null = null;

  constructor(id: string) {
    this.#id = id;
  }

  [CLONE_SYMBOL](context: CloneContext): TreeNode {
    const copy = context.register(this, new TreeNode(this.#id));
    copy.parent = context.clone(this.parent);
    return copy;
  }
}
```

Register the destination before cloning children. Registering a different destination for the same source throws.

## `isEqual(a, b, options?)`

```ts
import { isEqual } from 'quorin/state';

isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }); // true
isEqual(NaN, NaN);                                   // true
isEqual(0, -0);                                      // false
isEqual(new Set([1, 2]), new Set([2, 1]));           // false: insertion order matters
```

- Primitives use `Object.is`.
- Records and arrays compare prototypes, own keys (including symbols and holes), and property descriptors. Getters are compared by identity and never called.
- Dates compare time values, regular expressions compare source, flags, and `lastIndex`, and buffers and views compare kind, offset, and bytes.
- **Maps and Sets are compared in insertion order.** This is deliberate: it avoids hidden quadratic matching.
- Alias topology matters: `{ a: x, b: x }` is not equal to `{ a: copy1, b: copy2 }`.
- Class instances and other unsupported objects compare by reference.

## `redact(value, options?)`

```ts
import { redact } from 'quorin/state';

logger.info(redact({ user: 'ada', password: 'hunter2', headers: { Authorization: 'Bearer x' } }));
// { user: 'ada', password: '[REDACTED]', headers: { Authorization: '[REDACTED]' } }
```

Returns a JSON projection safe to log and never mutates the input. Getters, `toJSON`, and clone hooks are never invoked.

| Option | Default | Description |
| --- | --- | --- |
| `keys` | `[]` | Extra key matchers (case-insensitive strings or regular expressions). |
| `defaultKeys` | `true` | Match keys containing password, secret, token, authorization, api key, private key, credential, or cookie. |
| `paths` | `[]` | Exact segment paths to mask, such as `['users', 0, 'email']`. |
| `mask` | `'[REDACTED]'` | Replacement text. |
| `serializeError` | | Custom projection for `Error` objects. |
| `maxDepth` / `maxNodes` | `128` / `100000` | Values beyond the limit become `'[TRUNCATED]'`. |

Projection rules: errors become `{ name, error: '[ERROR]' }` (messages, stacks, and causes can contain secrets, so they need `serializeError`), cycles become `'[CIRCULAR]'`, repeated references become `'[REFERENCE]'`, `bigint` becomes `'10n'`, non-finite numbers become strings, dates become ISO strings, maps become entry arrays (string keys are matched too), sets become arrays, buffers become `{ type, byteLength }` without contents, and functions, symbols, accessors, weak collections, and class instances become markers such as `'[FUNCTION]'` and `'[OBJECT]'`.

Redaction is a conservative projection, not proof that every secret was removed. Secrets inside ordinary strings or under unexpected key names remain. Test it against your own data.
