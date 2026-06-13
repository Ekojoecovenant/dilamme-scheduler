import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Job, JobInterval, JobPriority, JobStatus } from './job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJobDto {
  @ApiProperty({
    example: 'send_email',
    description: 'Job handler type',
  })
  type!: string;

  @ApiProperty({
    example: { to: 'test@gmail.com', subject: 'Welcome' },
    description: 'Job payload — shape depends on job type',
  })
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 1,
    description: '1=High, 2=Medium, 3=Low. Defaults to 2',
    enum: [1, 2, 3],
  })
  priority?: number;

  @ApiPropertyOptional({
    example: '2026-06-15T10:00:00Z',
    description: 'ISO timestamp — job will not run before this time',
  })
  scheduledAt?: Date;

  @ApiPropertyOptional({
    example: 'every_5_minutes',
    enum: JobInterval,
    description: 'Recurring interval — next run auto-schedules on completion',
  })
  interval?: JobInterval;

  @ApiPropertyOptional({
    example: ['uuid-of-job-1', 'uuid-of-job-2'],
    description: 'DAG dependencies — job will not run until all listed jobs are completed',
    type: [String],
  })
  dependencyIds?: string[];
}

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    
    @Inject(forwardRef(() => SchedulerService))
    private readonly schedulerService: SchedulerService,

    @InjectPinoLogger(JobsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(dto: CreateJobDto): Promise<Job> {
    const now = new Date();
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    const job = this.jobRepo.create({
      type: dto.type,
      payload: dto.payload,
      priority: dto.priority ?? JobPriority.MEDIUM,
      scheduledAt: scheduledAt,
      nextRunAt: scheduledAt ?? null,
      interval: dto.interval ?? null,
      dependencyIds: dto.dependencyIds ?? [],
      status: JobStatus.PENDING,
    });

    const saved = await this.jobRepo.save(job);

    this.logger.info(
      {
        event: 'job_created',
        jobId: saved.id,
        type: saved.type,
        priority: saved.priority,
      },
      'job created',
    );

    // enqueue into heap immediately after creation
    this.schedulerService.enqueue(saved);

    return saved;
  }

  async findAll(): Promise<Job[]> {
    return this.jobRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Job> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  async cancel(id: string): Promise<Job> {
    const job = await this.findOne(id);

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      throw new Error(`Cannot cancel a job that is already ${job.status}`);
    }

    if (job.status === JobStatus.PROCESSING) {
      this.logger.warn(
        {
          event: 'job_cancel_while_processing',
          jobId: id,
        },
        'cancel requested on processing job - marking cancelled, worker will detect on next cycle',
      );
    }

    // remove from heap immediately if still pending
    this.schedulerService.removeFromHeap(id);

    job.status = JobStatus.CANCELLED;
    const saved = await this.jobRepo.save(job);

    this.logger.info(
      {
        event: 'job_cancelled',
        jobId: id,
      },
      'job cancelled',
    );

    return saved;
  }

  async findDlq(): Promise<Job[]> {
    return this.jobRepo.find({
      where: { isDlq: true },
      order: { updatedAt: 'DESC' },
    });
  }

  async retryFromDlq(id: string): Promise<Job> {
    const job = await this.findOne(id);

    if (!job.isDlq) {
      throw new Error(`Job ${id} is not in the dead-letter queue`);
    }

    job.isDlq = false;
    job.status = JobStatus.PENDING;
    job.retryCount = 0;
    job.errorDetails = null;
    job.nextRunAt = null;

    const saved = await this.jobRepo.save(job);

    // re-enqueue into heap
    this.schedulerService.enqueue(saved);

    this.logger.info(
      {
        event: 'dlq_retry_requested',
        jobId: id,
      },
      'job manually retried from DLQ',
    );

    return saved;
  }

  async getDlqCount(): Promise<number> {
    return this.jobRepo.count({ where: { isDlq: true } });
  }

  async allDependenciesCompleted(dependencyIds: string[]): Promise<boolean> {
    if (dependencyIds.length === 0) return true;

    const completeDeps = await this.jobRepo.count({
      where: {
        id: In(dependencyIds),
        status: JobStatus.COMPLETED,
      },
    });

    return completeDeps === dependencyIds.length;
  }

  async getStats(): Promise<Record<string, number>> {
    const result = await this.jobRepo
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('job.is_dlq = false')
      .groupBy('job.status')
      .getRawMany();
    
    const stats: Record<string, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      dlq: 0,
    };

    for (const row of result) {
      stats[row.status] = parseInt(row.count, 10);
    }

    // dlq count separately
    stats.dlq = await this.jobRepo.count({ where: { isDlq: true } });

    return stats;
  }
}
