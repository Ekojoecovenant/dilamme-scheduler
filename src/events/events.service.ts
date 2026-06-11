import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface JobEvent {
  jobId: string;
  type: string;
  status: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  private eventStream$ = new Subject<JobEvent>();

  emit(event: JobEvent) {
    this.eventStream$.next(event);
  }

  getStream() {
    return this.eventStream$.asObservable();
  }
}
