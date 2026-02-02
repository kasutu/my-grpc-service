import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import { ContentPublisherService } from './content-publisher.service';
import {
  SubscribeRequest,
  ContentPackage,
  AckRequest,
  AckResponse,
} from 'src/generated/content/v1/content';

@Controller()
export class ContentController {
  constructor(private readonly publisher: ContentPublisherService) {}

  @GrpcMethod('ContentService')
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

  @GrpcMethod('ContentService')
  acknowledge(request: AckRequest): AckResponse {
    return this.publisher.acknowledge(
      request.deviceId,
      request.deliveryId,
      request.processedSuccessfully,
      request.errorMessage,
    );
  }
}
