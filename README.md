# Dilamme Scheduler

A production-grade background job scheduler built with NestJS (Fastify), PostgreSQL, and React. Ships with a heap-based priority queue, DAG workflow support, automatic retries, recurring jobs, dead-letter queue, and live SSE updates.

Built as a learning project during HNG14 Stage 9.

**Live Demo:** <https://scheduler.ekojoe.name.ng>

**API:** <https://scheduler-api.ekojoe.name.ng>

**API Docs:** <https://scheduler-api.ekojoe.name.ng/api/docs>

---

## What it does

- Creates and processes background jobs with three priority levels (High, Medium, Low)
- Schedules jobs for future execution — jobs only run when their time arrives
- Supports recurring jobs that automatically re-schedule themselves after completion
- Chains jobs into DAG workflows — a job waits for all its dependencies to complete before running
- Retries failed jobs up to 3 times with exponential backoff and jitter (~1s, ~5s, ~25s)
- Moves exhausted jobs to a dead-letter queue with full error details visible in the UI
- Fires an alert when the DLQ crosses 10 entries
- Prevents low-priority job starvation — the longer a job waits, the higher its effective priority becomes
- Streams live status updates to the UI via Server-Sent Events — no page refresh needed
- Guarantees no two workers can claim the same job simultaneously via SELECT FOR UPDATE SKIP LOCKED

---

## Tech stack

**Backend:** NestJS (Fastify adapter), TypeScript, TypeORM, PostgreSQL, pino

**Frontend:** React, Vite, TypeScript

**Infrastructure:** Ubuntu VPS, Nginx, pm2, Let's Encrypt

---

## Architecture highlights

**Heap-based priority queue** — jobs are ordered by priority, then scheduled time, then creation time. Implemented from scratch as a generic MinHeap class with full test coverage.

**Timing wheel** — a second scheduling algorithm implemented for comparison. Benchmarked against the heap at 1k and 10k jobs. Results in benchmark-results.json.

**DAG engine** — jobs declare dependencies via a uuid[] column. The worker checks all dependencies are completed before claiming a job.

**Starvation prevention** — every 30 seconds a waiting job's effective priority improves by one level. Documented threshold, documented formula.

**Dead-letter queue** — failed jobs after 3 attempts are flagged in-place (isDlq = true) rather than moved to a separate table. Engineers can inspect error details and trigger manual retries from the UI.

---

## Running locally

**Prerequisites:** Node.js 18+, pnpm, PostgreSQL

```bash
# clone the repo
git clone https://github.com/ekojoecovenant/dilamme-scheduler.git
cd dilamme-scheduler

# install dependencies
pnpm install

# create environment file
cp .env.example .env
# fill in your DB credentials

# start in development mode
pnpm run start:dev
```

The API will be available at <http://localhost:3000>

API docs at <http://localhost:3000/api/docs>

**Frontend:**

```bash
cd dilamme-ui
pnpm install
pnpm run dev
```

UI will be available at <http://localhost:5173>

---

## Environment variables

```plain
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_NAME=dilamme_scheduler
```

---

## Project structure

```plain
dilamme-scheduler/
├── src/
│   ├── jobs/           # Job entity, service, controller
│   ├── scheduler/      # MinHeap, TimingWheel, SchedulerService
│   ├── worker/         # WorkerService — polling, execution, retry
│   └── events/         # SSE stream
├── benchmark-results.json
└── ARCHITECTURE.md     # Full system design doc
```

---

## Benchmark results

| Algorithm   | Jobs   | Insert  | Retrieval | Memory  |
| ----------- | ------ | ------- | --------- | ------- |
| MinHeap     | 1,000  | 3.1ms   | 18.8ms    | 365KB   |
| TimingWheel | 1,000  | 1.5ms   | 0.2ms     | 114KB   |
| MinHeap     | 10,000 | 11.7ms  | 21.6ms    | 649KB   |
| TimingWheel | 10,000 | 6.8ms   | 0.05ms    | 956KB   |

The timing wheel wins on retrieval speed but cannot guarantee priority ordering within a time slot. The heap is used as the primary scheduler for this reason.

---

## Author

Ekojoe Covenant Lemom — Backend Engineer

<https://ekojoe.name.ng>
