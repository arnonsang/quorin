# Changelog

## Unreleased

- Add `typesVersions` so subpath imports such as `quorin/cache` type check under legacy `moduleResolution: "node"` (TypeScript 6 and earlier).
- Test declarations on TypeScript 5.8 as well as 7.0, including CommonJS consumers under `NodeNext`.
- Document TypeScript settings per project type, and align the documented `require` support with the Node 22.19.0 engines floor.

## 0.1.0 (2026-10-26)

First public preview with all nine modules.

- `quorin/struct`: `Deque`, `ValueMap`, `Multimap`
- `quorin/object`: `getPath`, `setPath`, `deepMerge`, `stableStringify`, `SecurityError`
- `quorin/bytes`: `concatBytes`, `equalsBytes`, `stringToBytes`, `bytesToString`, `toHex`, `fromHex`, `toBase64`, `fromBase64`, `fastHash`
- `quorin/async`: `concurrencyLimit`, `mapAsync`, `QueueError`
- `quorin/result`: `ok`, `err`, `trySafe`, `trySafeSync`, `isDefect`, `DefectError`
- `quorin/boundary`: `parseEnv`, `defineBoundary`, `formatIssues`, `BoundaryValidationError`
- `quorin/resilience`: `withResilience`, `isUserAbort`
- `quorin/cache`: `createCache`, `CacheError`
- `quorin/state`: `safeClone`, `isEqual`, `redact`, `CLONE_SYMBOL`, `StateError`
