import { Controller } from "@nestjs/common";
import { GrpcMethod, GrpcStreamMethod } from "@nestjs/microservices";
import { Observable, Subject } from "rxjs";
import { AnalyticsService } from "./analytics.service";
import type { Batch, Ack, Event } from "../generated/analytics/v1/analytics";

@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Fire-and-forget batch upload (primary method)
   */
  @GrpcMethod("AnalyticsService", "Ingest")
  ingest(batch: Batch): Ack {
    return this.analyticsService.ingest(batch);
  }

  /**
   * Optional: long-lived stream for real-time
   */
  @GrpcStreamMethod("AnalyticsService", "Stream")
  stream(events$: Observable<Event>): Observable<Ack> {
    const acks$ = new Subject<Ack>();

    events$.subscribe({
      next: (event) => {
        // For streaming, we create a single-event batch
        const batch: Batch = {
          batchId: event.eventId, // Use event ID as batch ID for single events
          events: [event],
          deviceFingerprint: 0, // Unknown in stream mode
          sentAtMs: Date.now(),
        };

        const ack = this.analyticsService.ingest(batch);
        acks$.next(ack);
      },
      error: (err) => {
        console.error("Stream error:", err);
        acks$.complete();
      },
      complete: () => {
        acks$.complete();
      },
    });

    return acks$.asObservable();
  }
}
