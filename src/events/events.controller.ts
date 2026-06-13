import { Controller, Sse } from '@nestjs/common';
import { EventsService, JobEvent } from './events.service';
import { map, Observable } from 'rxjs';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Sse()
  @ApiOperation({ summary: 'SSE stream of live job status changes' })
  @ApiResponse({
    status: 200,
    description: 'Stream of job events — connect and listen for real-time updates'
  })
  stream(): Observable<MessageEvent> {
    return this.eventsService.getStream().pipe(
      map((event: JobEvent) => ({
        data: event,
      } as MessageEvent)),
    );
  }
}
