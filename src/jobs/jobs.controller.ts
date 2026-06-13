import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { type CreateJobDto, JobsService } from './jobs.service';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new job' })
  @ApiResponse({ status: 201, description: 'Job created and enqueued into heap' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  create(@Body() dto: CreateJobDto) {
    return this.jobsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all jobs' })
  @ApiResponse({ status: 200, description: 'Array of all jobs ordered by createdAt DESC' })
  findAll() {
    return this.jobsService.findAll();
  }

  @Get('dlq')
  @ApiOperation({ summary: 'List all dead-letter queue jobs' })
  @ApiResponse({ status: 200, description: 'Jobs that exhausted all retries' })
  findDlq() {
    return this.jobsService.findDlq();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get job counts by status for dashboard' })
  stats() {
    return this.jobsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single job by ID' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 200, description: 'Job found' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a job' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 200, description: 'Job cancelled' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  cancel(@Param('id') id: string) {
    return this.jobsService.cancel(id);
  }

  @Post('dlq/:id/retry')
  @ApiOperation({ summary: 'Manually retry a job from the DLQ' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 201, description: 'Job reset to pending and re-enqueued' })
  retryFromDlq(@Param('id') id: string) {
    return this.jobsService.retryFromDlq(id);
  }
}