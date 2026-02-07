import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { Observable, Subject } from "rxjs";
import { CommandPublisherService } from "./command-publisher.service";
import type {
  SubscribeRequest,
  CommandPackage,
  AckRequest,
  AckResponse,
} from "src/generated/command/v1/command";

@Controller()
export class CommandController {
  constructor(private readonly publisher: CommandPublisherService) {}

  @GrpcMethod("RemoteCommandService")
  subscribeCommands(request: SubscribeRequest): Observable<CommandPackage> {
    const stream$ = this.publisher.subscribe(request.deviceId);

    stream$.subscribe({
      complete: () => {
        this.publisher.unsubscribe(request.deviceId);
      },
    });

    return stream$.asObservable();
  }

  @GrpcMethod("RemoteCommandService")
  acknowledgeCommand(request: AckRequest): AckResponse {
    return this.publisher.acknowledge(
      request.deviceId,
      request.commandId,
      request.processedSuccessfully,
      request.errorMessage,
    );
  }
}
