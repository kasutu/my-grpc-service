import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsHttpController } from './analytics-http.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsStoreService } from './services/analytics-store.service';
import { FleetAnalyticsService } from './services/fleet-analytics.service';
import { FleetModule } from '../fleet/fleet.module';

@Module({
  imports: [FleetModule],
  controllers: [AnalyticsController, AnalyticsHttpController],
  providers: [AnalyticsService, AnalyticsStoreService, FleetAnalyticsService],
  exports: [AnalyticsService, AnalyticsStoreService],
})
export class AnalyticsModule {}
