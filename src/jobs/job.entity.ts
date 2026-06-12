import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum JobPriority {
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
}

export enum JobInterval {
  EVERY_1_MINUTE = 'every_1_minute',
  EVERY_5_MINUTES = 'every_5_minutes',
  EVERY_1_HOUR = 'every_1_hour',
}

@Entity('jobs')
@Check(`"status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`)
@Check(`"priority" IN (1, 2, 3)`)
@Check(`"retry_count" >= 0 AND "retry_count" <= 3`)
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.PENDING,
  })
  status!: JobStatus;

  @Column({ type: 'int', default: JobPriority.MEDIUM })
  priority!: number;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'max_retries', type: 'int', default: 3 })
  maxRetries!: number;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({
    type: 'enum',
    enum: JobInterval,
    nullable: true,
  })
  interval!: JobInterval | null;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt!: Date | null;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'error_details', type: 'jsonb', nullable: true })
  errorDetails!: Record<string, unknown> | null;

  @Column({ name: 'dependency_ids', type: 'uuid', array: true, default: [] })
  dependencyIds!: string[];

  @Column({ name: 'is_dlq', type: 'boolean', default: false })
  isDlq!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;  
}