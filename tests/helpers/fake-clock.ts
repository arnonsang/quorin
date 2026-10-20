import { setClock, systemClock, type Clock } from '../../src/internal/clock.ts';

interface Timer {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
}

export class FakeClock implements Clock {
  #now = 0;
  #nextId = 1;
  #timers: Timer[] = [];
  randomValue = 0.5;

  now(): number {
    return this.#now;
  }

  random(): number {
    return this.randomValue;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const timer = { id: this.#nextId++, at: this.#now + ms, callback };
    this.#timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers = this.#timers.filter((timer) => timer.id !== handle);
  }

  get pendingTimers(): number {
    return this.#timers.length;
  }

  async advance(ms: number): Promise<void> {
    const target = this.#now + ms;
    for (;;) {
      await settle();
      const due = this.#timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.#timers = this.#timers.filter((timer) => timer !== due);
      this.#now = due.at;
      due.callback();
    }
    this.#now = target;
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

export function installFakeClock(): { clock: FakeClock; restore: () => void } {
  const clock = new FakeClock();
  setClock(clock);
  return { clock, restore: () => setClock(systemClock) };
}
