import { Module } from "@nestjs/common";
import { CommandController } from "./command.controller";
import { CommandPublisherService } from "./command-publisher.service";
import { CommandHttpController } from "./command-http.controller";

@Module({
  providers: [CommandPublisherService],
  controllers: [CommandController, CommandHttpController],
  exports: [CommandPublisherService],
})
export class CommandModule {}
