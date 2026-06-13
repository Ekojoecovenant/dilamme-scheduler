# Dilamme Scheduler — Architecture Document

## Overview

Dilamme Scheduler is a production-grade background job processing system built with NestJS (Fastify adapter), PostgreSQL, and React. It supports priority-based scheduling, DAG-dependent workflows, automatic retries with exponential backoff, recurring jobs, and a dead-letter queue — all with live SSE updates to the UI.

The system is deployed on a Ubuntu 26.04 VPS at scheduler-api.ekojoe.name.ng (API) and scheduler.ekojoe.name.ng (UI), with Nginx as a reverse proxy and HTTPS via Let's Encrypt.

---

## System Architecture

```plain
React UI (scheduler.ekojoe.name.ng)
         |
         | HTTPS + SSE
         v
Nginx (reverse proxy)
         |
    _____|______________________
    |                          |
    v                          v
NestJS API (port 3009)    Static UI (port 3010)
    |
    |-- JobsController    (REST endpoints)
    |-- SchedulerService  (MinHeap + tick loop)
    |-- WorkerService     (job execution + retry)
    |-- EventsService     (SSE stream)
    |
    v
PostgreSQL (jobs table)
```

The main application and the worker run in the same process but independently. The worker polls the heap every 2 seconds without blocking the HTTP layer. The scheduler ticks every 1 second to promote scheduled jobs and apply starvation aging.

---

## Job Lifecycle

Every job moves through exactly this state machine, enforced by PostgreSQL CHECK constraints:

pending → processing → completed
                    → failed (→ DLQ after 3 attempts)
                    → cancelled

No other transitions are permitted at the database level. Cancellation during processing is handled eventually — the worker checks for a cancelled status after execution completes and discards the result if found. This decision was made because workers are async and cannot be interrupted mid-execution safely.

---

## Heap-Based Priority Queue

The scheduler uses a custom MinHeap implementation in TypeScript. Jobs are ordered by a three-level comparator:

Level 1 — Priority (ascending): priority 1 (High) beats priority 2 (Medium) beats priority 3 (Low). Since it is a min-heap, numerically smaller values rise to the top.

Level 2 — nextRunAt (ascending): among jobs with equal priority, the one scheduled earliest runs first. Null values sort first.

Level 3 — createdAt (ascending): among jobs with equal priority and scheduled time, the oldest job runs first (FIFO).

The heap is implemented as a flat array. Index math:

- Parent of node i: Math.floor((i - 1) / 2)
- Left child of i: 2i + 1
- Right child of i: 2i + 2

Push operations call siftUp — the new element bubbles up until the heap property is satisfied. Pop operations remove the root, move the last element to position 0, and call siftDown — the element sinks until both children are larger.

Time complexity: O(log n) for push and pop. Space complexity: O(n).

Scheduled jobs (future scheduledAt) do not enter the heap immediately. They are tracked in a separate futureJobIds Set. The scheduler tick runs every second and promotes jobs whose time has arrived into the heap. This prevents the heap from being polluted with jobs that cannot run yet.

Recurring jobs re-enter the heap after completion via a new database insert with the next run time calculated as completedAt + intervalMs. The new job is a separate entity with a new UUID.

---

## Starvation Prevention

Low-priority jobs can starve if high-priority jobs keep arriving. The scheduler prevents this with a time-based aging formula applied on every tick:

effectivePriority = Math.max(1, originalPriority - Math.floor(waitMs / THRESHOLD))

Where THRESHOLD is 30,000ms (30 seconds). This means:

- A Low priority (3) job waiting 0–29s stays at priority 3
- After 30s it becomes priority 2
- After 60s it becomes priority 1 (same as High)

When any job's priority changes, the heap is rebuilt from scratch. This is O(n log n) but only happens when aging is actually detected, making it amortized cheap.

The threshold of 30 seconds was chosen to balance responsiveness (low-priority jobs are not ignored) against throughput (high-priority jobs still get meaningful precedence).

---

## DAG Workflow

Jobs can declare dependencies via a dependencyIds array (stored as a PostgreSQL uuid[] column). Before a job is claimed by a worker, the scheduler checks:

SELECT COUNT(*) FROM jobs WHERE id IN (dependencyIds) AND status = 'completed'

If the count equals the total number of dependencies, the job is eligible to run. Otherwise it is pushed back to the heap and checked again on the next cycle.

This supports linear chains (A → B → C) and fan-in patterns (A + B → C). Fan-out (A → B + C) is supported by creating B and C with dependencyIds: [A].

Example workflow evaluated during development:

- Generate Report (no dependencies) → runs first
- Upload File (depends on Generate Report) → runs after
- Send Email (depends on Upload File) → runs last

---

## Retry System and Dead-Letter Queue

Failed jobs retry automatically up to 3 times. The retry delay uses exponential backoff with random jitter to prevent thundering herd:

backoffMs = Math.pow(5, retryCount) \* 200 + Math.random() \* 1000

This produces approximately:

- Attempt 1: ~1.2 seconds
- Attempt 2: ~5 seconds  
- Attempt 3: ~25 seconds

After 3 failed attempts, the job is marked failed, isDlq is set to true, and the error details are stored in a JSONB column. The job stays in the same jobs table — the DLQ is a logical view (WHERE is_dlq = true) rather than a separate table, keeping queries simple.

When the DLQ count crosses 10 entries, an alert is logged at ERROR level. In production this would trigger an email or Slack notification. The threshold of 10 was chosen as a reasonable signal that something systemic is failing rather than isolated noise.

Engineers can manually retry DLQ jobs via POST /jobs/dlq/:id/retry. This resets retryCount to 0, clears errorDetails, sets status back to pending, and re-enqueues into the heap.

---

## Duplicate Protection

The worker uses PostgreSQL's SELECT FOR UPDATE SKIP LOCKED inside a transaction to claim jobs. This ensures:

1. Only one worker can hold the lock on a given row at a time
2. Other workers skip locked rows rather than waiting
3. The status update to processing is atomic with the lock

An in-process isRunning flag provides a second layer of protection — if a tick fires while the previous tick is still processing a job, the new tick exits immediately without attempting to claim another job.

---

## Alternative Scheduling Algorithm — Timing Wheel

A timing wheel was implemented alongside the heap as a comparison algorithm. The timing wheel uses a circular array of 60 slots, each representing a 1-second time bucket. Jobs are placed into slot (currentSlot + delayTicks) % 60. A pointer advances every second and executes all jobs in the current slot.

Benchmark results (Node.js, same machine):

1,000 jobs:

- MinHeap insert: 3.1ms, retrieval: 18.8ms, memory: 365KB
- TimingWheel insert: 1.5ms, retrieval: 0.2ms, memory: 114KB

10,000 jobs:

- MinHeap insert: 11.7ms, retrieval: 21.6ms, memory: 649KB
- TimingWheel insert: 6.8ms, retrieval: 0.05ms, memory: 956KB

The timing wheel is significantly faster at retrieval (O(1) tick vs O(log n) pop) but loses its memory advantage at scale because it pre-allocates all 60 slots regardless of job count. More critically, the timing wheel cannot guarantee ordering within a slot — two jobs due at the same second have no priority relationship. This makes it unsuitable as the primary scheduler for a system with explicit priority levels.

The heap is used as the primary scheduler. The timing wheel would be preferable for systems with millions of uniform recurring jobs at fixed intervals where within-window ordering does not matter.

---

## Structured Logging

All significant events are logged using pino via nestjs-pino. Every log line is structured JSON with at minimum: level, timestamp, pid, hostname, context (service name), event (machine-readable key), and a human-readable message.

Events logged:

- job_created — on successful DB insert
- job_started — when worker claims and begins execution
- retry_attempted — on each failure before DLQ
- job_failed — when job exhausts all retries and enters DLQ
- job_cancelled — on cancellation request
- job_completed — on successful execution
- dlq_threshold_exceeded — when DLQ count crosses 10
- heap_push — when job enters the heap
- future_job_tracked — when scheduled job is deferred
- scheduled_job_promoted — when future job becomes due
- job_aged — when starvation prevention boosts a job's priority
- recurring_job_scheduled — when next recurrence is created

In development, pino-pretty formats logs for readability. In production, raw JSON is emitted for log aggregator consumption.

---

## Known Limitations and Future Improvements

The worker is single-threaded — one job per 2-second tick. For higher throughput, multiple concurrent worker instances could be spawned, each competing for jobs via SELECT FOR UPDATE SKIP LOCKED. The locking mechanism already supports this without code changes.

Job handlers are registered via a switch statement in executeHandler(). A handler registry pattern (a Map of type strings to handler functions) would be cleaner and allow runtime handler registration.

The forwardRef pattern is used across JobsModule, SchedulerModule, and WorkerModule due to circular dependencies. The cleaner architectural solution would be an event bus — JobsService emits a JobCreated event that SchedulerService listens to, eliminating the direct dependency.

---

## Deployment

- Server: Ubuntu 26.04 VPS (37.27.20.73)
- Process manager: pm2 (auto-restart on crash, survives reboots via pm2 startup)
- Reverse proxy: Nginx 1.28.3
- HTTPS: Let's Encrypt via Certbot (auto-renewal configured)
- API: <https://scheduler-api.ekojoe.name.ng>
- UI: <https://scheduler.ekojoe.name.ng>
- API docs: <https://scheduler-api.ekojoe.name.ng/api/docs>
