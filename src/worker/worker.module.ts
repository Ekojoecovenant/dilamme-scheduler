import { Module } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { EventsModule } from '../events/events.module';
import { Job } from '../jobs/job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job]),
    JobsModule,
    EventsModule,
  ],
  providers: [WorkerService]
})
export class WorkerModule {}
