import { Module } from '@nestjs/common';
import { ContentModule } from './content/content.module';
import { CommandModule } from './command/command.module';
import { FleetModule } from './fleet/fleet.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [ContentModule, CommandModule, FleetModule, AnalyticsModule],
})
export class AppModule {}
