import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';

@ApiTags('scheduler')
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get heap scheduler stats' })
  stats() {
    return {
      heapSize: this.schedulerService.getHeapSize(),
      algorithm: 'MinHeap',
      starvationThresholdMs: 30_000,
      dlqAlertThreshold: 10,
    };
  }
}