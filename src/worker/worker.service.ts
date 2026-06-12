import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, JobInterval, JobStatus } from '../jobs/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryDeepPartialEntity, Repository } from 'typeorm';
import { JobsService } from '../jobs/jobs.service';
import { EventsService } from '../events/events.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SchedulerService } from '../scheduler/scheduler.service';

const POLL_INTERVAL_MS = 2000;
const DLQ_ALERT_THRESHOLD = 10;

const INTERVAL_MS: Record<JobInterval, number> = {
  [JobInterval.EVERY_1_MINUTE]: 60_000,
  [JobInterval.EVERY_5_MINUTES]: 5 * 60_000,
  [JobInterval.EVERY_1_HOUR]: 60 * 60_000,
};

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,

    private readonly jobsService: JobsService,
    private readonly eventsService: EventsService,
    private readonly schedulerService: SchedulerService,
    private readonly dataSource: DataSource,

    @InjectPinoLogger(WorkerService.name)
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap() {
    this.logger.info({ event: 'worker_started' }, 'worker polling started');
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.logger.info({ event: 'worker_stopped' }, 'worker polling stopped');
  }

  private async tick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.processNextJob();
    } catch (err) {
      this.logger.error(
        { event: 'worker_tick_error', err },
        'unexpected error in worker tick'
      )
    } finally {
      this.isRunning = false;
    }
  }

  private async processNextJob() {
    const job = await this.claimNextJob();
    if (!job) return;

    this.logger.info(
      { event: 'job_started', jobId: job.id, type: job.type },
      'job started',
    );

    this.eventsService.emit({
      jobId: job.id,
      type: job.type,
      status: JobStatus.PROCESSING,
      timestamp: new Date().toISOString(),
    });

    try {
      await this.executeHandler(job);

      // re-fetch to check if cancelled while processing
      const fresh = await this.jobRepo.findOne({ where: { id: job.id } });
      if (fresh?.status === JobStatus.CANCELLED) {
        this.logger.warn(
          { event: 'job_cancelled_during_processing', jobId: job.id },
          'job was cancelled during processing - discarding result',
        );
        return;
      }

      job.status = JobStatus.COMPLETED;
      job.completedAt = new Date();
      job.lastRunAt = new Date();
      await this.jobRepo.save(job);

      this.logger.info(
        { event: 'job_completed', jobId: job.id, type: job.type },
        'job completed',
      );

      this.eventsService.emit({
        jobId: job.id,
        type: job.type,
        status: JobStatus.COMPLETED,
        timestamp: new Date().toISOString(),
      });

      await this.scheduleNextRecurring(job);
    } catch (err) {
      await this.handleFailure(job, err);
    }
  }

  private async claimNextJob(): Promise<Job | null> {
    const job = this.schedulerService.dequeue();
    if (!job) return null;

    // verify dependencies in DB before claiming
    const depsReady = await this.jobsService.allDependenciesCompleted(
      job.dependencyIds,
    );

    if (!depsReady) {
      // put it back - deps not done yet
      this.schedulerService.enqueue(job);
      return null;
    }

    // claim it in the DB atomically
    return this.dataSource.transaction(async (manager) => {
      const fresh = await manager.findOne(Job, { where: { id: job.id } });

      // guard: job may have been cancelled between heap pop and now
      if (!fresh || fresh.status !== JobStatus.PENDING) {
        return null;
      }

      fresh.status = JobStatus.PROCESSING;
      fresh.startedAt = new Date();
      return manager.save(fresh);
    });
  }

  private async executeHandler(job: Job): Promise<void> {
    switch (job.type) {
      case 'send_email':
        await this.handleSendEmail(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async handleSendEmail(job: Job): Promise<void> {
    const payload  = job.payload as {
      to: string;
      subject: string;
      body?: string;
    };

    if (!payload.to || !payload.subject) {
      throw new Error('send_email requires "to" and "subject" in payload');
    }

    // simulate network delay
    await this.sleep(300 + Math.random() * 700);

    // simulate occasional failure (20% chance) so you can see retries working
    if (Math.random() < 0.2) {
      throw new Error(`SMTP connection refused (simulated failed)`);
    }

    this.logger.info(
      {
        event: 'email_sent',
        jobId: job.id,
        to: payload.to,
        subject: payload.subject,
      },
      'email simulated successfully',
    );
  }

  private async handleFailure(job: Job, err: unknown): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    job.retryCount += 1;

    this.logger.warn(
      {
        event: 'retry_attempted',
        jobId: job.id,
        type: job.type,
        attempt: job.retryCount,
        error: errorMessage,
      },
      `job failed, attempt ${job.retryCount} of ${job.maxRetries}`,
    );

    if (job.retryCount >= job.maxRetries) {
      job.status = JobStatus.FAILED;
      job.isDlq = true;
      job.errorDetails = {
        message: errorMessage,
        failedAt: new Date().toISOString(),
        totalAttempts: job.retryCount,
      };

      await this.jobRepo.save(job);

      this.logger.error(
        {
          event: 'job_failed',
          jobId: job.id,
          tpe: job.type,
          errorDetails: job.errorDetails,
        },
        'job exhausted all retries - moved to DLQ',
      );

      this.eventsService.emit({
        jobId: job.id,
        type: job.type,
        status: JobStatus.FAILED,
        timestamp: new Date().toISOString(),
        meta: { isDlq: true, error: errorMessage },
      });

      await this.checkDlqThreshold();
    } else {
      // backoff with jitter: ~1s, ~5s, ~25s
      const backoffMs = Math.pow(5, job.retryCount) * 200 + Math.random() * 1000;
      job.status = JobStatus.PENDING;
      job.nextRunAt = new Date(Date.now() + backoffMs);
      job.errorDetails = {
        lastError: errorMessage,
        lastAttempt: new Date().toISOString(),
      };

      await this.jobRepo.save(job);

      this.eventsService.emit({
        jobId: job.id,
        type: job.type,
        status: JobStatus.PENDING,
        timestamp: new Date().toISOString(),
        meta: { retryCount: job.retryCount, nextRunAt: job.nextRunAt },
      });
    }
  }

  private async scheduleNextRecurring(job: Job): Promise<void> {
    if (!job.interval) return;

    const intervalMs = INTERVAL_MS[job.interval];
    const nextRun = new Date(Date.now() + intervalMs);

    const nextJob = this.jobRepo.create({
      type: job.type,
      payload: job.payload,
      priority: job.priority,
      interval: job.interval,
      dependencyIds: job.dependencyIds,
      status: JobStatus.PENDING,
      scheduledAt: nextRun,
      nextRunAt: nextRun,
    });

    await this.jobRepo.save(nextJob);

    this.logger.info(
      {
        event: 'recurring_job_scheduled',
        parentJobId: job.id,
        nextRunAt: nextRun,
      },
      'next recurring run scheduled',
    );
  }

  private async checkDlqThreshold(): Promise<void> {
    const count = await this.jobsService.getDlqCount();

    if (count >= DLQ_ALERT_THRESHOLD) {
      this.logger.error(
        {
          event: 'dlq_threshold_exceeded',
          count,
          threshold: DLQ_ALERT_THRESHOLD,
        },
        `DLQ threshold exceeded (${count} jobs) - alert would fire here`,
      );
      // in production: call your email/slack alert service here
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
