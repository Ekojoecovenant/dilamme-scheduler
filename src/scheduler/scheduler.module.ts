import { forwardRef, Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/job.entity';
import { JobsModule } from '../jobs/jobs.module';
import { WorkerModule } from '../worker/worker.module';
import { SchedulerController } from './scheduler.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job]),
    forwardRef(() => JobsModule),
    forwardRef(() => WorkerModule),
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
