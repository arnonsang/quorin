# Compatibility

Runtimes, TypeScript versions, and compiler settings.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## Runtime support

| Runtime | Status |
| --- | --- |
| Node 22.19.0+, 24, 26 | Tested in CI |
| Bun, Deno, Cloudflare workerd, Chromium, Firefox, WebKit | Targets, not yet verified |

Required capabilities: ES2022, `Promise`, `AbortController` and `AbortSignal`, timers, `TextEncoder` and `TextDecoder`, and `performance.now`. The core does not need `fetch`, `crypto`, `structuredClone`, `AbortSignal.any`, or `AbortSignal.timeout`.

## TypeScript settings

TypeScript consumers need TypeScript 5.8 or later. Declarations are tested on TypeScript 5.8 and 7.0 with `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.

| Your project | `module` / `moduleResolution` | Result |
| --- | --- | --- |
| ESM (`"type": "module"`) | `NodeNext` or `Node16` | Works |
| Bundled app (Vite, webpack, esbuild, Bun) | `ESNext` + `Bundler` | Works |
| CommonJS | `NodeNext` (TS 5.8+) or `Node20` (TS 5.9+) | Works |
| CommonJS | `Node16` or `Node18` | Error TS1479: TypeScript assumes those Node versions cannot `require` ES modules. Switch to `NodeNext`. |
| Legacy `moduleResolution: "node"` (`node10`) | `CommonJS` + `Node10` | Works through `typesVersions` on TypeScript 6 and earlier. TypeScript 7 removed this mode, so plan to move to `NodeNext` or `Bundler`. |

Zero runtime dependencies reduces supply-chain exposure; it does not remove implementation risk or maintenance cost.
