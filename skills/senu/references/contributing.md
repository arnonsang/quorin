# Contributing to senu

Use this when changing the senu repository itself.

## Layout

```
src/
  index.ts              root: `export * from './<module>/index.ts'` for all nine modules
  <module>/index.ts     the public manifest of a subpath
  <module>/*.ts         one primitive per file, so a subpath import evaluates only what it needs
  internal/             private helpers: errors.ts, validate.ts, abort.ts, clock.ts, budget.ts, json.ts, key-codec.ts, linked-queue.ts
tests/
  runtime/*.test.ts     behavior tests (node:test) run directly on the TypeScript sources
  types/*.types.ts      compile-time tests (expectType<Equal<...>>, @ts-expect-error)
  package/              packs the tarball, installs it, checks imports, require, identity, and declarations
  helpers/              deferred promises, fake clock, seeded random, fake schema
skills/senu/            this agent skill
```

Dependency direction: `bytes` depends on nothing else public; `boundary` and `resilience` depend on `result`; everything may use `internal`. Public code never imports through the root barrel, and the graph must stay acyclic.

## Scripts

```sh
npm run typecheck      # tsc over src and tests
npm test               # runtime tests
npm run test:coverage  # thresholds: lines 99, branches 97, functions 98; writes coverage/lcov.info
npm run test:package   # build, pack, install, import every subpath, require(esm), consumer typecheck
npm run check:skill    # typechecks every ts block in skills/senu/references/{recipes,building-on-senu}.md
npm run check          # everything
```

All of these must pass before a change is done. CI runs them on Node 22.19.0, 22, 24, and 26.

## Conventions

- **Errors**: throw through the helpers in `src/internal/errors.ts` (`invalidArgument`, `unsupportedValue`, `traversalLimit`, ...) or a module error class with a `code`. Add a new code to `SenuErrorCode` and to the README error table. Messages never include user values.
- **Validation**: use `src/internal/validate.ts` (`assertInteger`, `assertDuration`, `assertFunction`, `assertOptionalSignal`, `assertOptionsObject`). Async entry points reject instead of throwing.
- **Cancellation**: subscribe with `onAbort` from `src/internal/abort.ts`, which returns an idempotent unsubscribe. Check `signal.aborted` before invoking user code, remove listeners on every terminal path, and attach handlers to every user promise so late rejections are observed.
- **Time**: get the clock with `getClock()` and schedule with `schedule(clock, ms, callback)` from `src/internal/clock.ts`. Tests install `FakeClock` from `tests/helpers/fake-clock.ts` and advance it. Never call `setTimeout` or `Date.now()` directly in library code.
- **Imports**: relative `.ts` specifiers (rewritten on build), `import type` for types (`verbatimModuleSyntax`), no enums, namespaces with values, or parameter properties (`erasableSyntaxOnly`). Exported functions need explicit return types (`isolatedDeclarations`).
- **No side effects at import**: no timers, globals, or environment access at module top level. Create `TextEncoder`-like objects lazily.
- **Comments**: JSDoc on public exports only, short and factual. Avoid other comments; prefer clear names.
- **Style**: two-space indentation, single quotes, semicolons, no en or em dash characters anywhere.

## Adding or changing an export

1. Implement it in `src/<module>/<name>.ts`.
2. Export it (and its option types) from `src/<module>/index.ts`. The root picks it up automatically, and the package test checks that root and subpath exports match.
3. Add runtime tests covering valid input, every rejection path, and ownership, plus type tests for inference and expected errors.
4. Keep coverage above the thresholds.
5. Update the README section for the module, `skills/senu/references/api.md`, and `CHANGELOG.md`.

Adding a whole new subpath also needs an `exports` entry in `package.json`, the module name in the `subpaths` list in `tests/package/package.test.mjs`, a line in `src/index.ts`, and a row in the README and skill module tables.

## Commits

Small, focused commits with conventional prefixes: `feat(cache): ...`, `fix(bytes): ...`, `test(async): ...`, `docs: ...`, `chore: ...`, `ci: ...`.
