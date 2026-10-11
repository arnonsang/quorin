import type { JsonValue } from '../internal/json.ts';
import { decodeKey, encodeKey } from '../internal/key-codec.ts';

export class ValueMap<K extends JsonValue, V> implements Iterable<[K, V]> {
  readonly #entries = new Map<string, V>();

  get size(): number {
    return this.#entries.size;
  }

  set(key: K, value: V): this {
    this.#entries.set(encodeKey(key), value);
    return this;
  }

  get(key: K): V | undefined {
    return this.#entries.get(encodeKey(key));
  }

  has(key: K): boolean {
    return this.#entries.has(encodeKey(key));
  }

  delete(key: K): boolean {
    return this.#entries.delete(encodeKey(key));
  }

  clear(): void {
    this.#entries.clear();
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [encoded, value] of this.#entries) yield [decodeKey<K>(encoded), value];
  }

  *keys(): IterableIterator<K> {
    for (const encoded of this.#entries.keys()) yield decodeKey<K>(encoded);
  }

  values(): IterableIterator<V> {
    return this.#entries.values();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}
