export interface Clock {
  now(): number;
  epochNow(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

const MAX_TIMER_DELAY = 2_147_483_647;

export const systemClock: Clock = {
  now: () => performance.now(),
  epochNow: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  random: () => Math.random(),
};

let current: Clock = systemClock;

export function getClock(): Clock {
  return current;
}

export function setClock(clock: Clock): void {
  current = clock;
}

export function schedule(clock: Clock, ms: number, callback: () => void): () => void {
  let handle: unknown;
  let cancelled = false;
  let remaining = ms;
  const arm = (): void => {
    const step = Math.min(remaining, MAX_TIMER_DELAY);
    remaining -= step;
    handle = clock.setTimeout(() => {
      if (cancelled) return;
      if (remaining > 0) arm();
      else callback();
    }, step);
  };
  arm();
  return () => {
    if (cancelled) return;
    cancelled = true;
    clock.clearTimeout(handle);
  };
}
