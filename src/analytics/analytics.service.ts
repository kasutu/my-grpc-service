import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsStoreService } from './services/analytics-store.service';
import type {
  AnalyticsBatch,
  BatchAck,
  UploadPolicy,
  AnalyticsEvent,
} from '../generated/analytics/v1/analytics';
import type {
  PlaybackRecord,
  ErrorRecord,
  HealthRecord,
} from './interfaces/analytics.types';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  // Default server-side upload policy
  private readonly defaultPolicy: UploadPolicy = {
    maxBatchSize: 100,
    syncIntervalSeconds: 300, // 5 minutes
    retryDelaysSeconds: [1, 2, 4, 8, 15],
  };

  constructor(private readonly store: AnalyticsStoreService) {}

  /**
   * Process an analytics batch upload from a device
   */
  uploadBatch(batch: AnalyticsBatch): BatchAck {
    return this.processBatch(batch);
  }

  /**
   * Process an analytics batch upload from a device (internal)
   */
  private processBatch(batch: AnalyticsBatch): BatchAck {
    // Validate batch exists
    if (!batch) {
      return {
        accepted: false,
        batchId: '',
        failedEventIds: [],
        rejectionReason: 'Missing batch',
        policy: this.defaultPolicy,
      };
    }

    // Validate deviceId
    if (!batch.deviceId) {
      return {
        accepted: false,
        batchId: batch.batchId || '',
        failedEventIds: [],
        rejectionReason: 'Missing device_id',
        policy: this.defaultPolicy,
      };
    }

    // Validate batchId
    if (!batch.batchId) {
      return {
        accepted: false,
        batchId: '',
        failedEventIds: [],
        rejectionReason: 'Missing batch_id',
        policy: this.defaultPolicy,
      };
    }

    // Validate events array exists and is not empty
    if (!batch.events || !Array.isArray(batch.events) || batch.events.length === 0) {
      return {
        accepted: false,
        batchId: batch.batchId,
        failedEventIds: [],
        rejectionReason: 'Empty batch (no events)',
        policy: this.defaultPolicy,
      };
    }

    // Validate batch size
    if (batch.events.length > this.defaultPolicy.maxBatchSize) {
      return {
        accepted: false,
        batchId: batch.batchId,
        failedEventIds: [],
        rejectionReason: `Batch size exceeds maximum (${batch.events.length} > ${this.defaultPolicy.maxBatchSize})`,
        policy: this.defaultPolicy,
      };
    }

    this.logger.log(
      `Received analytics batch ${batch.batchId} from device ${batch.deviceId} with ${batch.events.length} events`,
    );

    // Convert and store events
    const failedEventIds: string[] = [];
    const eventsToStore: Array<{
      eventId: string;
      timestampMs: number;
      category: 'PLAYBACK' | 'ERROR' | 'HEALTH';
      payload: PlaybackRecord | ErrorRecord | HealthRecord;
    }> = [];

    for (const event of batch.events) {
      const converted = this.convertEvent(event);
      if (converted) {
        eventsToStore.push(converted);
      } else {
        failedEventIds.push(event.eventId || 'unknown');
      }
    }

    // Store valid events
    if (eventsToStore.length > 0) {
      this.store.storeEvents(batch.deviceId, batch.batchId, eventsToStore);
    }

    const success = failedEventIds.length === 0;

    if (success) {
      this.logger.log(`Batch ${batch.batchId} accepted (${eventsToStore.length} events)`);
    } else {
      this.logger.warn(
        `Batch ${batch.batchId} partially accepted (${eventsToStore.length}/${batch.events.length} events)`,
      );
    }

    return {
      accepted: success,
      batchId: batch.batchId,
      failedEventIds,
      rejectionReason: success ? undefined : 'Some events failed to process',
      policy: this.defaultPolicy,
    };
  }

  /**
   * Get the current upload policy
   */
  getPolicy(): UploadPolicy {
    return this.defaultPolicy;
  }

  /**
   * Convert protobuf event to internal format
   */
  private convertEvent(event: AnalyticsEvent): {
    eventId: string;
    timestampMs: number;
    category: 'PLAYBACK' | 'ERROR' | 'HEALTH';
    payload: PlaybackRecord | ErrorRecord | HealthRecord;
  } | null {
    if (!event || !event.eventId) {
      this.logger.warn('Event missing event_id, skipping');
      return null;
    }

    const base = {
      eventId: event.eventId,
      timestampMs: event.timestampMs || Date.now(),
    };

    // Check payload oneof based on category
    switch (event.category) {
      case 1: // EVENT_CATEGORY_PLAYBACK
        if (event.playback) {
          return {
            ...base,
            category: 'PLAYBACK' as const,
            payload: {
              campaignId: event.playback.campaignId || '',
              mediaId: event.playback.mediaId || '',
              durationMs: event.playback.durationMs || 0,
              completed: event.playback.completed || false,
            },
          };
        }
        break;
      case 2: // EVENT_CATEGORY_ERROR
        if (event.error) {
          return {
            ...base,
            category: 'ERROR' as const,
            payload: {
              errorType: event.error.errorType || 'UNKNOWN',
              message: event.error.message || '',
              stackTrace: event.error.stackTrace,
              component: event.error.component || 'unknown',
              isFatal: event.error.isFatal || false,
            },
          };
        }
        break;
      case 3: // EVENT_CATEGORY_HEALTH
        if (event.health) {
          return {
            ...base,
            category: 'HEALTH' as const,
            payload: {
              batteryLevel: event.health.batteryLevel,
              storageFreeBytes: event.health.storageFreeBytes,
              cpuUsage: event.health.cpuUsage,
              memoryUsage: event.health.memoryUsage,
              connectionQuality: this.mapConnectionQuality(event.health.connectionQuality),
            },
          };
        }
        break;
    }

    this.logger.warn(`Event ${event.eventId} has no recognized payload, skipping`);
    return null;
  }

  /**
   * Map connection quality enum to string
   */
  private mapConnectionQuality(quality: number): string {
    const map: Record<number, string> = {
      0: 'UNSPECIFIED',
      1: 'EXCELLENT',
      2: 'GOOD',
      3: 'FAIR',
      4: 'POOR',
      5: 'OFFLINE',
    };
    return map[quality] || 'UNKNOWN';
  }
}
