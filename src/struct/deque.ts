import { capacityExceeded, concurrentModification } from '../internal/errors.ts';
import { assertInteger } from '../internal/validate.ts';

const MIN_CAPACITY = 8;
const MAX_CAPACITY = 2 ** 30;

function normalizeCapacity(requested: number): number {
  let capacity = MIN_CAPACITY;
  while (capacity < requested) capacity *= 2;
  return capacity;
}

export class Deque<T> implements Iterable<T> {
  #buffer: (T | undefined)[];
  #mask: number;
  #head = 0;
  #length = 0;
  #version = 0;
  readonly #initialCapacity: number;

  constructor(initialCapacity: number = 16) {
    assertInteger('initialCapacity', initialCapacity, 1, MAX_CAPACITY);
    this.#initialCapacity = normalizeCapacity(initialCapacity);
    this.#buffer = new Array<T | undefined>(this.#initialCapacity);
    this.#mask = this.#initialCapacity - 1;
  }

  get size(): number {
    return this.#length;
  }

  push(value: T): number {
    if (this.#length === this.#buffer.length) this.#grow();
    this.#buffer[(this.#head + this.#length) & this.#mask] = value;
    this.#version++;
    return ++this.#length;
  }

  unshift(value: T): number {
    if (this.#length === this.#buffer.length) this.#grow();
    this.#head = (this.#head - 1) & this.#mask;
    this.#buffer[this.#head] = value;
    this.#version++;
    return ++this.#length;
  }

  pop(): T | undefined {
    if (this.#length === 0) return undefined;
    this.#length--;
    const index = (this.#head + this.#length) & this.#mask;
    const value = this.#buffer[index];
    this.#buffer[index] = undefined;
    this.#version++;
    return value;
  }

  shift(): T | undefined {
    if (this.#length === 0) return undefined;
    const value = this.#buffer[this.#head];
    this.#buffer[this.#head] = undefined;
    this.#head = (this.#head + 1) & this.#mask;
    this.#length--;
    this.#version++;
    return value;
  }

  peek(): T | undefined {
    return this.#length === 0 ? undefined : this.#buffer[this.#head];
  }

  peekBack(): T | undefined {
    return this.#length === 0 ? undefined : this.#buffer[(this.#head + this.#length - 1) & this.#mask];
  }

  clear(): void {
    this.#buffer = new Array<T | undefined>(this.#initialCapacity);
    this.#mask = this.#initialCapacity - 1;
    this.#head = 0;
    this.#length = 0;
    this.#version++;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    const version = this.#version;
    for (let offset = 0; offset < this.#length; offset++) {
      yield this.#buffer[(this.#head + offset) & this.#mask] as T;
      if (this.#version !== version) throw concurrentModification('Deque was modified during iteration');
    }
  }

  #grow(): void {
    const capacity = this.#buffer.length;
    if (capacity >= MAX_CAPACITY) throw capacityExceeded(`Deque cannot grow beyond ${MAX_CAPACITY} slots`);
    const next = new Array<T | undefined>(capacity * 2);
    for (let offset = 0; offset < this.#length; offset++) {
      next[offset] = this.#buffer[(this.#head + offset) & this.#mask];
    }
    this.#buffer = next;
    this.#mask = next.length - 1;
    this.#head = 0;
  }
}
