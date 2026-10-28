# Development

Working on quorin itself: scripts, layout, and releases.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

```sh
npm install
npm run typecheck      # tsc over src and tests, including type-level tests
npm test               # runtime tests on the TypeScript sources
npm run test:coverage  # tests with coverage thresholds, writes coverage/lcov.info
npm run test:package   # builds, packs, installs the tarball, and checks imports, require, and types
npm run check:skill    # typechecks the code examples in the agent skill
npm run check          # all of the above
```

Tests use the built-in `node:test` runner and run the TypeScript sources directly through Node's type stripping. The package test installs the packed tarball into a clean fixture without dev dependencies, imports the root and every subpath, checks that both resolve to the same objects, loads the package with `require`, and type checks a consumer.

The layout:

```
src/
  index.ts          root re-exports
  <module>/         one folder per public subpath
  internal/         shared private helpers (validation, clock, abort, queue, JSON codec)
tests/
  runtime/          behavior and regression tests
  types/            compile-time type tests
  package/          packed tarball tests
docs/               user documentation, one page per module
skills/quorin/      agent skill (SKILL.md, references, evals)
```

To report coverage to Codecov from CI, add a `CODECOV_TOKEN` repository secret.

## Releasing

Releases are published from CI with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and provenance. Bump the version and push the tag:

```sh
npm version patch   # or minor, major; updates package.json and creates the v* tag
git push --follow-tags
```

The `Release` workflow checks that the tag matches `package.json`, runs `npm run check`, and publishes. If the package uses npm staged publishing, approve the staged version with `npm stage approve <id>` or on npmjs.com.
