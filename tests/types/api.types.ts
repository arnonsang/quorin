import { z } from 'zod';
import { defineBoundary, type BoundaryValidationError } from '../../src/boundary/index.ts';
import { createCache, type Cache, type LoadingCache } from '../../src/cache/index.ts';
import { deepMerge, getPath, setPath, type Path, type PathValue } from '../../src/object/index.ts';
import {
  after,
  Channel,
  createRateLimiter,
  createTaskGroup,
  receive,
  select,
  send,
  singleFlight,
  spawn,
  type ChannelReceiver,
  type ChannelReceiveResult,
  type ChannelSender,
} from '../../src/async/index.ts';
import { onAbort, timeoutSignal } from '../../src/signal/index.ts';
import { parseRetryAfter, withResilience, type RunFailure } from '../../src/resilience/index.ts';
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
void withResilience(async () => 1, {
  retries: 1,
  retrySafe: true,
  shouldRetry: () => true,
  retryDelayMs: ({ error, attempt }) => {
    expectType<Equal<typeof error, unknown>>();
    expectType<Equal<typeof attempt, number>>();
    return 10;
  },
});
void withResilience(async () => 1, {
  mapError: () => 404 as const,
  retries: 1,
  retrySafe: true,
  shouldRetry: (error: 404) => error === 404,
  retryDelayMs: ({ error }) => {
    expectType<Equal<typeof error, 404>>();
    return Promise.resolve(5);
  },
});
// @ts-expect-error the hook must return a number or a promise of a number
void withResilience(async () => 1, { retryDelayMs: () => 'soon' });
const parsed = parseRetryAfter('120');
expectType<Equal<typeof parsed, number | null>>();
const numberChannel = new Channel<number>();
void numberChannel.send(1).then(() => undefined);
void numberChannel.receive().then((value) => expectType<Equal<typeof value, number>>());
// @ts-expect-error sends must match the declared value type
void numberChannel.send('one');
const probe = numberChannel.tryReceive();
if (probe.ok) expectType<Equal<typeof probe.value, number>>();
else expectType<Equal<typeof probe.closed, boolean>>();
const sender: ChannelSender<number> = numberChannel.sendOnly();
const receiver: ChannelReceiver<number> = numberChannel.receiveOnly();
// @ts-expect-error receive-only views cannot close the channel
receiver.close();
void sender;
declare const genericChannel: Channel<{ id: string } | undefined>;
async function drain(channel: ChannelReceiver<{ id: string } | undefined>): Promise<({ id: string } | undefined)[]> {
  const seen: ({ id: string } | undefined)[] = [];
  for await (const value of channel) seen.push(value);
  return seen;
}
void drain(genericChannel);

async function selectNarrowing(jobs: Channel<string>, quit: Channel<number>): Promise<void> {
  const [value, index] = await select([receive(jobs), receive(quit), after(1000)]);
  if (index === 0) expectType<Equal<typeof value, ChannelReceiveResult<string>>>();
  if (index === 1) expectType<Equal<typeof value, ChannelReceiveResult<number>>>();
  if (index === 2) expectType<Equal<typeof value, undefined>>();
  const [maybe, which] = await select([send(jobs, 'job')], { default: null });
  if (which === -1) expectType<Equal<typeof maybe, null>>();
  // @ts-expect-error send values must match the channel type
  send(jobs, 1);
}
void selectNarrowing;

const spawned = spawn(async () => 1);
void spawned.result.then((result) => expectType<Equal<typeof result, SafeResult<number, unknown>>>());
const mappedSpawn = spawn(async () => 'x', { mapError: () => 'mapped' as const });
void mappedSpawn.result.then((result) => expectType<Equal<typeof result, SafeResult<string, 'mapped'>>>());
const group = createTaskGroup<number>();
group.run(async () => 1);
// @ts-expect-error tasks must produce the group value type
group.run(async () => 'one');
void group.wait().then((result) => expectType<Equal<typeof result, SafeResult<number[], unknown>>>());
const loadProfile = singleFlight(async (args: readonly [id: string], { signal }: { signal: AbortSignal }) =>
  fetch(args[0], { signal }).then((response) => response.json() as Promise<unknown>),
);
void loadProfile(['u1']).then((value) => expectType<Equal<typeof value, unknown>>());
void loadProfile(['u1'], { signal: AbortSignal.abort('x') }).then(() => undefined, () => undefined);
// @ts-expect-error args must match the wrapped function
void loadProfile([42]);
const stop = onAbort(undefined, () => undefined);
expectType<Equal<typeof stop, () => void>>();
const deadline = timeoutSignal(100);
expectType<Equal<typeof deadline.signal, AbortSignal>>();
deadline.cancel();
void deadline;
void stop();
const limiter = createRateLimiter({ rate: 100, intervalMs: 60_000, burst: 25 });
expectType<Equal<typeof limiter.tokens, number>>();
void limiter.acquire({ weight: 0.5 }).then(() => undefined);
const got = limiter.tryAcquire();
expectType<Equal<typeof got, boolean>>();

const map = new ValueMap<{ id: number }, string>();
// @ts-expect-error keys must be JSON values
new ValueMap<Date, string>();
void map;
