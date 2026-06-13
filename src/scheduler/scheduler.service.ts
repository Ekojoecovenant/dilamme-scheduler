import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { MinHeap } from './min-heap';
import { Job, JobStatus } from '../jobs/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const SCHEDULER_TICK_MS = 1000;
const STARVATION_THRESHOLD_MS = 30_000;

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private heap = new MinHeap<Job>();
  private timer: NodeJS.Timeout | null = null;
  private loadedIds = new Set<string>();

  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,

    @InjectPinoLogger(SchedulerService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap() {
    await this.loadPendingJobs();
    this.timer = setInterval(() => this.tick(), SCHEDULER_TICK_MS);
    this.logger.info({ event: 'scheduler_started' }, 'heap scheduler started');
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.logger.info({ event: 'scheduler_stopped' }, 'heap scheduler stopped');
  }

  // called by JobsService after create a new job
  enqueue(job: Job): void {
    if (this.loadedIds.has(job.id)) return;

    // scheduled jobs only enter heap when their time is due
    // we still track them so the tick can pick them up
    this.loadedIds.add(job.id);

    if (!job.scheduledAt || job.scheduledAt <= new Date()) {
      this.heap.push(job);
      this.logger.debug(
        { event: 'heap_push', jobId: job.id, heapSize: this.heap.size },
        'job pushed to heap',
      );
    }
  }
  
  // called by WorkerService to get the next ready job
  dequeue(): Job | undefined {
    const now = new Date();

    while (!this.heap.isEmpty()) {
      const top = this.heap.peek()!;

      // skip if not due yet
      if (top.nextRunAt && top.nextRunAt > now) break;

      // dependency check
      return this.heap.pop();
    }

    return undefined;
  }

  // called by WorkerService or JobsService on cancellation
  removeFromHeap(jobId: string): void {
    const removed = this.heap.remove(jobId);
    if (removed) {
      this.loadedIds.delete(jobId);
      this.logger.debug(
        { event: 'heap_remove', jobId },
        'job removed from heap',
      );
    }
  }

  getHeapSize(): number {
    return this.heap.size;
  }

  private async loadPendingJobs(): Promise<void> {
    const jobs = await this.jobRepo.find({
      where: { status: JobStatus.PENDING, isDlq: false },
    });

    for (const job of jobs) {
      this.enqueue(job);
    }

    this.logger.info(
      { event: 'heap_loaded', count: jobs.length, heapSize: this.heap.size },
      `loaded ${jobs.length} pending jobs into heap on startup`,
    );
  }

  private tick(): void {
    this.applyAgingToHeap();
    this.promoteScheduledJobs();
  }

  // starvation prevention - aging formula
  // every STARVATION_THRESHOLD_MS a low-priority job waits,
  // its effective priority improves by 1 (e.g. 3 -> 2 -> 1)
  private applyAgingToHeap(): void {
    const now = Date.now();
    const jobs = this.heap.toArray();
    let rebuilt = false;

    for (const job of jobs) {
      if (job.priority <= 1) continue;

      const waitMs = now - job.createdAt.getTime();
      const steps = Math.floor(waitMs / STARVATION_THRESHOLD_MS);
      const agedPriority = Math.max(1, job.priority - steps);

      if (agedPriority !== job.priority) {
        job.priority = agedPriority;
        rebuilt = true;
        this.logger.debug(
          {
            event: 'job_aged',
            jobId: job.id,
            newPriority: agedPriority,
            waitMs,
          },
          'job priority boosted due to starvation prevention',
        );
      }
    }

    if (rebuilt) {
      // rebuild head from scratch after priority mutations
      this.heap = new MinHeap<Job>();
      for (const job of jobs) this.heap.push(job);
    }
  }

  // push scheduled jobs into heap when their time arrives
  private promoteScheduledJobs(): void {
    const now  = new Date();
    const jobs = this.heap.toArray();

    for (const job of jobs) {
      if (job.scheduledAt && job.scheduledAt > now) {
        // not due yet - check if it just became due
        if (job.nextRunAt && job.nextRunAt <= now) {
          this.logger.debug(
            { event: 'scheduled_job_due', jobId: job.id },
            'scheduled job is now due',
          );
        }
      }
    }

    // also check loadedIds for jobs not yet in heap
    // (jobs with future scheduledAt that are now due)
    this.checkFutureJobs(now);
  }

  private async checkFutureJobs(now: Date): Promise<void> {
    const dueSoon = await this.jobRepo.find({
      where: { status: JobStatus.PENDING, isDlq: false },
    });

    for (const job of dueSoon) {
      if (!this.loadedIds.has(job.id)) {
        const isDue = !job.nextRunAt || job.nextRunAt <= now;
        if (isDue) {
          this.enqueue(job);
        }
      }
    }
  }
}
