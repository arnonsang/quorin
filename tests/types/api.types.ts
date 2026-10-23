import { z } from 'zod';
import { defineBoundary, type BoundaryValidationError } from '../../src/boundary/index.ts';
import { createCache, type Cache, type LoadingCache } from '../../src/cache/index.ts';
import { deepMerge, getPath, setPath, type Path, type PathValue } from '../../src/object/index.ts';
import { withResilience, type RunFailure } from '../../src/resilience/index.ts';
import { err, ok, trySafe, trySafeSync, type SafeResult } from '../../src/result/index.ts';
import { ValueMap } from '../../src/struct/index.ts';
import { expectType, type Equal } from './expect.ts';

declare const result: SafeResult<number, string>;
if (result.ok) {
  expectType<Equal<typeof result.data, number>>();
  expectType<Equal<typeof result.error, null>>();
} else {
  expectType<Equal<typeof result.error, string>>();
  expectType<Equal<typeof result.data, null>>();
}
const [first, second] = ok('x');
expectType<Equal<typeof first, null>>();
expectType<Equal<typeof second, string | null>>();
expectType<Equal<ReturnType<typeof err<'e'>>, SafeResult<never, 'e'>>>();
expectType<Equal<ReturnType<typeof trySafeSync<number>>, SafeResult<number, unknown>>>();
const mapped = trySafeSync(() => 1, { mapError: () => 'mapped' as const });
expectType<Equal<typeof mapped, SafeResult<number, 'mapped'>>>();
void trySafe(async () => 1).then((value) => expectType<Equal<typeof value, SafeResult<number, unknown>>>());

interface Config {
  server: { port: number; host?: string };
  tags: string[];
  pair: [string, number];
  meta: Record<string, boolean>;
}
declare const config: Config;
const port = getPath(config, ['server', 'port']);
expectType<Equal<typeof port, number>>();
const host = getPath(config, 'server.host');
expectType<Equal<typeof host, string | undefined>>();
const tag = getPath(config, ['tags', 0]);
expectType<Equal<typeof tag, string | undefined>>();
const pairValue = getPath(config, ['pair', 1]);
expectType<Equal<typeof pairValue, number>>();
const flag = getPath(config, ['meta', 'x'], false);
expectType<Equal<typeof flag, boolean | undefined>>();
const missing = getPath(config, ['nope']);
expectType<Equal<typeof missing, undefined>>();
declare const dynamicPath: string[];
const dynamic = getPath(config, dynamicPath);
expectType<Equal<typeof dynamic, unknown>>();
expectType<Equal<PathValue<Config, ['server']>, { port: number; host?: string }>>();
const validPath: Path<Config> = ['server', 'port'];
void validPath;

setPath(config, ['server', 'port'], 8080);
// @ts-expect-error the value must match the selected location
setPath(config, ['server', 'port'], 'eighty');
setPath(config, dynamicPath, 'anything');

const merged = deepMerge({ a: { x: 1, y: 'keep' }, b: 'left' }, { a: { x: 'replaced' }, b: 2 });
expectType<Equal<typeof merged.a.x, 'replaced'>>();
expectType<Equal<typeof merged.a.y, 'keep'>>();
expectType<Equal<typeof merged.b, 2>>();

const plain = createCache<string, number>({ max: 1 });
expectType<Equal<typeof plain, Cache<string, number>>>();
// @ts-expect-error getOrFetch requires a loader
plain.getOrFetch('a');
const loading = createCache({ max: 1, load: async (key: string) => key.length });
expectType<Equal<typeof loading, LoadingCache<string, number>>>();

const boundary = defineBoundary(z.object({ id: z.string().transform(Number) }), (input) => {
  expectType<Equal<typeof input, { id: number }>>();
  return input.id;
});
void boundary(1).then((outcome) => expectType<Equal<typeof outcome, SafeResult<number, unknown>>>());
const mappedBoundary = defineBoundary(z.string(), (input) => input, { mapError: () => 'handler' as const });
void mappedBoundary(1).then((outcome) =>
  expectType<Equal<typeof outcome, SafeResult<string, BoundaryValidationError | 'handler'>>>(),
);

void withResilience(async () => 1).then((outcome) => {
  expectType<Equal<typeof outcome, SafeResult<number, RunFailure<unknown>>>>();
});
void withResilience(async () => 1, { mapError: () => 404 as const }).then((outcome) => {
  if (!outcome.ok && outcome.error.kind === 'task') expectType<Equal<typeof outcome.error.error, 404>>();
});

const map = new ValueMap<{ id: number }, string>();
// @ts-expect-error keys must be JSON values
new ValueMap<Date, string>();
void map;
