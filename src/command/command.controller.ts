import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { Observable, Subject } from "rxjs";
import { CommandPublisherService } from "./command-publisher.service";
import {
  type SubscribeRequest,
  type CommandPackage,
  type AcknowledgeRequest,
  type AcknowledgeResponse,
} from "src/generated/command/v1/command";

@Controller()
export class CommandController {
  constructor(private readonly publisher: CommandPublisherService) {}

  @GrpcMethod("CommandService")
  subscribeCommands(request: SubscribeRequest): Observable<CommandPackage> {
    const stream$ = this.publisher.subscribe(request.deviceId);

    stream$.subscribe({
      complete: () => {
        this.publisher.unsubscribe(request.deviceId);
      },
    });

    return stream$.asObservable();
  }

  @GrpcMethod("CommandService")
  acknowledge(request: AcknowledgeRequest): AcknowledgeResponse {
    this.publisher.acknowledge(
      request.deviceId,
      request.commandId,
      request.status,
      request.message,
    );
    return {
      accepted: true,
      retryAfterSeconds: 0,
    };
  }
}
