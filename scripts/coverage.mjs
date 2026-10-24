import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('coverage', { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=src/**',
    '--test-coverage-lines=99',
    '--test-coverage-branches=97',
    '--test-coverage-functions=98',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    '--test-reporter-destination=coverage/lcov.info',
    'tests/runtime/**/*.test.ts',
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
