// File: src/fleet/fleet.module.ts
import { Module } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { CommandModule } from '../command/command.module';
import { ContentModule } from '../content/content.module';

@Module({
  imports: [CommandModule, ContentModule],
  providers: [FleetService],
  controllers: [FleetController],
  exports: [FleetService],
})
export class FleetModule {}
