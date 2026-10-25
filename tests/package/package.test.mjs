import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const subpaths = ['struct', 'object', 'bytes', 'async', 'result', 'boundary', 'resilience', 'cache', 'state'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let workspace;
let fixture;
let packed;

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'quorin-package-'));
  const output = JSON.parse(run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', workspace], root));
  packed = output[0];
  fixture = join(workspace, 'fixture');
  mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }));
  run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', join(workspace, packed.filename)], fixture);
});

after(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
});

describe('packed package', () => {
  it('contains only distributable files', () => {
    const files = packed.files.map((file) => file.path);
    assert.ok(files.includes('dist/index.js'));
    assert.ok(files.includes('dist/index.d.ts'));
    assert.ok(files.includes('LICENSE'));
    assert.ok(files.includes('THIRD_PARTY_NOTICES.md'));
    assert.ok(files.includes('README.md'));
    assert.equal(files.some((file) => file.startsWith('src/') || file.startsWith('tests/')), false);
  });

  it('has no runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(fixture, 'node_modules/quorin/package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined);
    assert.deepEqual(readdirSync(join(fixture, 'node_modules')).sort(), ['.package-lock.json', 'quorin']);
  });

  it('emits no JavaScript import that points at a TypeScript file', () => {
    const dist = join(fixture, 'node_modules/quorin/dist');
    const offenders = [];
    for (const entry of readdirSync(dist, { recursive: true })) {
      if (!String(entry).endsWith('.js')) continue;
      const text = readFileSync(join(dist, String(entry)), 'utf8');
      if (/from\s+['"][^'"]+\.ts['"]/.test(text) || /import\(['"][^'"]+\.ts['"]\)/.test(text)) offenders.push(entry);
    }
    assert.deepEqual(offenders, []);
  });

  it('imports the root and every subpath with shared identity', () => {
    const script = `
      const rootModule = await import('quorin');
      const names = new Set();
      for (const subpath of ${JSON.stringify(subpaths)}) {
        const mod = await import('quorin/' + subpath);
        for (const [name, value] of Object.entries(mod)) {
          if (rootModule[name] !== value) throw new Error('identity mismatch for ' + name);
          names.add(name);
        }
      }
      if (Object.keys(rootModule).length !== names.size) throw new Error('root exports differ from subpaths');
      console.log(names.size);
    `;
    const count = Number(run(process.execPath, ['--input-type=module', '-e', script], fixture).trim());
    assert.ok(count > 40);
  });

  it('supports require of the ESM graph', () => {
    const script = `
      const quorin = require('quorin');
      const cache = require('quorin/cache');
      if (quorin.createCache !== cache.createCache) throw new Error('identity mismatch');
      const [error, data] = quorin.ok(1);
      if (error !== null || data !== 1) throw new Error('unexpected result');
      console.log('ok');
    `;
    assert.equal(run(process.execPath, ['--input-type=commonjs', '-e', script], fixture).trim(), 'ok');
  });

  for (const mode of [
    { module: 'NodeNext', moduleResolution: 'NodeNext' },
    { module: 'ESNext', moduleResolution: 'Bundler' },
  ]) {
    it(`type checks a consumer with ${mode.moduleResolution} resolution`, () => {
      const dir = join(fixture, `types-${mode.moduleResolution.toLowerCase()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'consumer.ts'), `
        import { Deque, ok, type SafeResult } from 'quorin';
        import { createCache } from 'quorin/cache';
        import { getPath } from 'quorin/object';
        import { withResilience } from 'quorin/resilience';

        const deque = new Deque<number>();
        deque.push(1);
        const result: SafeResult<number> = ok(1);
        if (result.ok) {
          const value: number = result.data;
          void value;
        }
        const cache = createCache<string, number>({ max: 10, load: async () => 1 });
        void cache.getOrFetch('a');
        const port: number | undefined = getPath({ server: { port: 1 } }, 'server.port');
        void port;
        void withResilience(async ({ attempt }) => attempt);
        // @ts-expect-error caches without a loader do not expose getOrFetch
        createCache<string, number>({ max: 1 }).getOrFetch('a');
      `);
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          ...mode,
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          types: [],
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: false,
          noEmit: true,
        },
        include: ['consumer.ts'],
      }));
      run(join(root, 'node_modules/.bin/tsc'), ['-p', dir], fixture);
    });
  }
});
