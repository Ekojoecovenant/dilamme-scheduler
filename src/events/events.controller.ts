import { Controller, Sse } from '@nestjs/common';
import { EventsService, JobEvent } from './events.service';
import { map, Observable } from 'rxjs';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Sse()
  stream(): Observable<MessageEvent> {
    return this.eventsService.getStream().pipe(
      map((event: JobEvent) => ({
        data: event,
      } as MessageEvent)),
    );
  }
}
