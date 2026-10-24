/** A map from each key to an ordered list of values, duplicates included. */
export class Multimap<K, V> implements Iterable<[K, readonly V[]]> {
  readonly #entries = new Map<K, V[]>();
  #valueCount = 0;

  get size(): number {
    return this.#entries.size;
  }

  get valueCount(): number {
    return this.#valueCount;
  }

  add(key: K, value: V): this {
    const values = this.#entries.get(key);
    if (values === undefined) this.#entries.set(key, [value]);
    else values.push(value);
    this.#valueCount++;
    return this;
  }

  get(key: K): readonly V[] {
    return this.#entries.get(key)?.slice() ?? [];
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  delete(key: K): boolean {
    const values = this.#entries.get(key);
    if (values === undefined) return false;
    this.#valueCount -= values.length;
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
    this.#valueCount = 0;
  }

  keys(): IterableIterator<K> {
    return this.#entries.keys();
  }

  *entries(): IterableIterator<[K, readonly V[]]> {
    for (const [key, values] of this.#entries) yield [key, values.slice()];
  }

  [Symbol.iterator](): IterableIterator<[K, readonly V[]]> {
    return this.entries();
  }
}
