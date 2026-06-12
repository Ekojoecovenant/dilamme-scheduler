import { MinHeap, Schedulable } from './min-heap';
import { TimingWheel, WheelJob } from './timing-wheel';

interface BenchmarkResult {
  algorithm: string;
  jobCount: number;
  insertTimeMs: number;
  retrievalTimeMs: number;
  memoryBytes: number;
}

function makeHeapJob(id: string, delayMs: number): Schedulable {
  return {
    id,
    priority: Math.ceil(Math.random() * 3),
    nextRunAt: new Date(Date.now() + delayMs),
    createdAt: new Date(),
  };
}

function makeWheelJob(id: string, delayMs: number): WheelJob {
  return {
    id,
    priority: Math.ceil(Math.random() * 3),
    scheduledAt: new Date(Date.now() + delayMs),
    createdAt: new Date(),
    data: {},
  };
}

function benchmarkHeap(jobCount: number): BenchmarkResult {
  const heap = new MinHeap<Schedulable>();
  const jobs = Array.from({ length: jobCount }, (_, i) =>
    makeHeapJob(`heap-${i}`, Math.random() * 55000),
  );

  const memBefore = process.memoryUsage().heapUsed;

  // benchmark insert
  const insertStart = performance.now();
  for (const job of jobs) heap.push(job);
  const insertEnd = performance.now();

  const memAfter = process.memoryUsage().heapUsed;

  // benchmark retrieval
  const retrievalStart = performance.now();
  while (!heap.isEmpty()) heap.pop();
  const retrievalEnd = performance.now();

  return {
    algorithm: 'MinHeap',
    jobCount,
    insertTimeMs: parseFloat((insertEnd - insertStart).toFixed(3)),
    retrievalTimeMs: parseFloat((retrievalEnd - retrievalStart).toFixed(3)),
    memoryBytes: memAfter - memBefore,
  };
}

function benchmarkWheel(jobCount: number): BenchmarkResult {
  const wheel = new TimingWheel(60, 1000);
  const jobs = Array.from({ length: jobCount }, (_, i) =>
    makeWheelJob(`wheel-${i}`, Math.random() * 55000),
  );

  const memBefore = process.memoryUsage().heapUsed;

  // benchmark insert
  const insertStart = performance.now();
  for (const job of jobs) wheel.insert(job);
  const insertEnd = performance.now();

  const memAfter = process.memoryUsage().heapUsed;

  // benchmark retrieval (drain all slots)
  const retrievalStart = performance.now();
  for (let i = 0; i < 60; i++) wheel.tick();
  const retrievalEnd = performance.now();

  return {
    algorithm: 'TimingWheel',
    jobCount,
    insertTimeMs: parseFloat((insertEnd - insertStart).toFixed(3)),
    retrievalTimeMs: parseFloat((retrievalEnd - retrievalStart).toFixed(3)),
    memoryBytes: memAfter - memBefore,
  };
}

function printTable(results: BenchmarkResult[]): void {
  console.log('\n========================================');
  console.log('  SCHEDULER ALGORITHM BENCHMARK RESULTS');
  console.log('========================================\n');

  for (const r of results) {
    console.log(`Algorithm    : ${r.algorithm}`);
    console.log(`Job Count    : ${r.jobCount.toLocaleString()}`);
    console.log(`Insert Time  : ${r.insertTimeMs}ms`);
    console.log(`Retrieval    : ${r.retrievalTimeMs}ms`);
    console.log(`Memory Delta : ${(r.memoryBytes / 1024).toFixed(2)} KB`);
    console.log('----------------------------------------');
  }

  console.log('\nTRADEOFF SUMMARY:');
  console.log('MinHeap   → O(log n) insert/pop, exact ordering, great for sparse jobs');
  console.log('TimingWheel → O(1) insert/tick, fixed resolution, great for dense uniform load');
  console.log('');
}

// run benchmarks
const counts = [1_000, 10_000];
const results: BenchmarkResult[] = [];

for (const count of counts) {
  results.push(benchmarkHeap(count));
  results.push(benchmarkWheel(count));
}

printTable(results);

// save results to JSON for architecture doc
import { writeFileSync } from 'fs';
writeFileSync(
  'benchmark-results.json',
  JSON.stringify(results, null, 2),
);
console.log('Results saved to benchmark-results.json');