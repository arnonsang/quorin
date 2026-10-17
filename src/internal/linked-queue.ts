export interface QueueNode<T> {
  readonly value: T;
  prev: QueueNode<T> | null;
  next: QueueNode<T> | null;
  linked: boolean;
}

export class LinkedQueue<T> {
  #head: QueueNode<T> | null = null;
  #tail: QueueNode<T> | null = null;
  #size = 0;

  get size(): number {
    return this.#size;
  }

  push(value: T): QueueNode<T> {
    const node: QueueNode<T> = { value, prev: this.#tail, next: null, linked: true };
    if (this.#tail === null) this.#head = node;
    else this.#tail.next = node;
    this.#tail = node;
    this.#size++;
    return node;
  }

  shift(): T | undefined {
    const node = this.#head;
    if (node === null) return undefined;
    this.remove(node);
    return node.value;
  }

  remove(node: QueueNode<T>): boolean {
    if (!node.linked) return false;
    if (node.prev === null) this.#head = node.next;
    else node.prev.next = node.next;
    if (node.next === null) this.#tail = node.prev;
    else node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
    node.linked = false;
    this.#size--;
    return true;
  }

  drain(): T[] {
    const values: T[] = [];
    while (this.#head !== null) {
      const node = this.#head;
      this.remove(node);
      values.push(node.value);
    }
    return values;
  }
}
