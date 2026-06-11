import { MinHeap } from './min-heap';

const makeJob = (id: string, priority: number, offsetMs = 0) => ({
  id,
  priority,
  nextRunAt: new Date(Date.now() + offsetMs),
  createdAt: new Date(),
});

describe('MinHeap', () => {
  it('pops in priority order', () => {
    const heap = new MinHeap<ReturnType<typeof makeJob>>();
    heap.push(makeJob('low', 3));
    heap.push(makeJob('high', 1));
    heap.push(makeJob('medium', 2));

    expect(heap.pop()?.id).toBe('high');
    expect(heap.pop()?.id).toBe('medium');
    expect(heap.pop()?.id).toBe('low');
  });

  it('breaks priority ties by nextRunAt', () => {
    const heap = new MinHeap<ReturnType<typeof makeJob>>();
    heap.push(makeJob('later', 1, 5000));
    heap.push(makeJob('sooner', 1, 1000));

    expect(heap.pop()?.id).toBe('sooner');
  });

  it('removes a job by id', () => {
    const heap = new MinHeap<ReturnType<typeof makeJob>>();
    heap.push(makeJob('a', 1));
    heap.push(makeJob('b', 2));
    heap.push(makeJob('c', 3));

    heap.remove('b');
    const remaining = [];
    while (!heap.isEmpty()) remaining.push(heap.pop()?.id);

    expect(remaining).not.toContain('b');
    expect(remaining).toHaveLength(2);
  });
});