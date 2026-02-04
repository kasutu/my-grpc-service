import { Module } from '@nestjs/common';
import { ContentModule } from './content/content.module';
import { CommandModule } from './command/command.module';
import { FleetModule } from './fleet/fleet.module';

@Module({
  imports: [ContentModule, CommandModule, FleetModule],
})
export class AppModule {}
