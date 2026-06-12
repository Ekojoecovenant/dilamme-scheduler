import { forwardRef, Module } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { EventsModule } from '../events/events.module';
import { Job } from '../jobs/job.entity';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job]),
    forwardRef(() => JobsModule),
    EventsModule,
    forwardRef(() => SchedulerModule),
  ],
  providers: [WorkerService],
  exports: [WorkerService]
})
export class WorkerModule {}
