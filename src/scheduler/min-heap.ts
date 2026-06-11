export interface Schedulable {
  id: string;
  priority: number;
  nextRunAt: Date | null;
  createdAt: Date;
}

export class MinHeap<T extends Schedulable> {
  private heap: T[] = [];

  private compare(a: T, b: T): number {
    // tiebreaker 1: priority (1=high,, 3=low - lower number wins)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // tiebreaker 2: nextRunAt (earlier time wins, nulls first)
    const aTime = a.nextRunAt?.getTime() ?? 0;
    const bTime = b.nextRunAt?.getTime() ?? 0;
    if (aTime !== bTime) {
      return aTime - bTime;
    }

    // tiebreaker 3: createdAt (older job wins - FIFO)
    return a.createdAt.getTime() - b.createdAt.getTime();
  }

  private parentIdx(i: number): number {
    return Math.floor((i - 1) / 2);
  }

  private leftIdx(i: number): number {
    return 2 * i + 1;
  }

  private rightIdx(i: number): number {
    return 2 * i + 2;
  }

  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = this.parentIdx(i);
      if (this.compare(this.heap[i], this.heap[parent]) < 0) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(i: number): void {
    const length = this.heap.length;

    while (true) {
      let smallest = i;
      const left = this.leftIdx(i);
      const right = this.rightIdx(i);

      if (
        left < length &&
        this.compare(this.heap[left], this.heap[smallest]) < 0
      ) {
        smallest = left;
      }

      if (
        right < length &&
        this.compare(this.heap[right], this.heap[smallest]) < 0
      ) {
        smallest = right;
      }

      if (smallest !== i) {
        this.swap(i, smallest);
        i = smallest;
      } else {
        break;
      }
    }
  }

  push(item: T): void {
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }
  
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const root = this.heap[0];
    // move last element to root, then sift it down
    this.heap[0] = this.heap.pop()!;
    this.siftDown(0);
    return root;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  remove(id: string): boolean {
    const idx = this.heap.findIndex((item) => item.id === id);
    if (idx === -1) return false;

    if (idx === this.heap.length - 1) {
      this.heap.pop();
      return true;
    }

    this.heap[idx] = this.heap.pop()!;
    this.siftUp(idx);
    this.siftDown(idx);
    return true;
  }

  toArray(): T[] {
    return [...this.heap];
  }
}