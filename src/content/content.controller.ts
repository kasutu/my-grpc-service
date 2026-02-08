import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { Observable, Subject } from "rxjs";
import { ContentPublisherService } from "./content-publisher.service";
import {
  type SubscribeRequest,
  type ContentPackage,
  type AcknowledgeRequest,
  type AcknowledgeResponse,
} from "src/generated/content/v1/content";

@Controller()
export class ContentController {
  constructor(private readonly publisher: ContentPublisherService) {}

  @GrpcMethod("ContentService")
  subscribe(request: SubscribeRequest): Observable<ContentPackage> {
    const stream$ = this.publisher.subscribe(
      request.deviceId,
      request.lastReceivedDeliveryId,
    );

    // Cleanup on disconnect
    stream$.subscribe({
      complete: () => {
        this.publisher.unsubscribe(request.deviceId);
      },
    });

    return stream$.asObservable();
  }

  @GrpcMethod("ContentService")
  acknowledge(request: AcknowledgeRequest): AcknowledgeResponse {
    const result = this.publisher.acknowledge(
      request.deviceId,
      request.deliveryId,
      request.status,
      request.message,
      request.progress,
    );

    return {
      accepted: result.accepted,
      retryAfterSeconds: 0,
    };
  }
}
