import { forwardRef, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from './job.entity';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job]),
    forwardRef(() => SchedulerModule),
  ],
  providers: [JobsService],
  controllers: [JobsController],
  exports: [JobsService]
})
export class JobsModule {}
