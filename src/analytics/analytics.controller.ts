import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AnalyticsService } from './analytics.service';
import type {
  AnalyticsBatch,
  BatchAck,
} from 'src/generated/analytics/v1/analytics';

@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @GrpcMethod('AnalyticsService')
  async uploadBatch(batch: AnalyticsBatch): Promise<BatchAck> {
    return this.analyticsService.uploadBatch(batch);
  }
}
