import { Injectable, NotFoundException } from '@nestjs/common';
import { Job, JobInterval, JobPriority, JobStatus } from './job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface CreateJobDto {
  type: string;
  payload: Record<string, unknown>;
  priority?: number;
  scheduledAt?: Date;
  interval?: JobInterval;
  dependencyIds?: string[];
}

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,

    @InjectPinoLogger(JobsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(dto: CreateJobDto): Promise<Job> {
    const job = this.jobRepo.create({
      type: dto.type,
      payload: dto.payload,
      priority: dto.priority ?? JobPriority.MEDIUM,
      scheduledAt: dto.scheduledAt ?? null,
      nextRunAt: dto.scheduledAt ?? null,
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
}
