import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsHttpController } from './analytics-http.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsStoreService } from './services/analytics-store.service';

@Module({
  imports: [],
  controllers: [AnalyticsController, AnalyticsHttpController],
  providers: [AnalyticsService, AnalyticsStoreService],
  exports: [AnalyticsService, AnalyticsStoreService],
})
export class AnalyticsModule {}
