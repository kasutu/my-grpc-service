import type {
  AnalyticsBatch,
  AnalyticsEvent,
  PlaybackEvent,
  ErrorEvent,
  HealthEvent,
  NetworkContext,
  QueueStatus,
} from '../../src/generated/analytics/v1/analytics';
import {
  ConnectionQuality,
  EventCategory,
} from '../../src/generated/analytics/v1/analytics';

/**
 * Fixture utilities for analytics testing
 */
export class AnalyticsFixture {
  private static eventIdCounter = 0;
  private static batchIdCounter = 0;

  /**
   * Generate a unique event ID
   */
  static generateEventId(): string {
    return `evt-${Date.now()}-${++this.eventIdCounter}`;
  }

  /**
   * Generate a unique batch ID
   */
  static generateBatchId(): string {
    return `batch-${Date.now()}-${++this.batchIdCounter}`;
  }

  /**
   * Create a playback event
   */
  static createPlaybackEvent(overrides?: Partial<PlaybackEvent>): AnalyticsEvent {
    return {
      eventId: this.generateEventId(),
      timestampMs: Date.now(),
      category: EventCategory.EVENT_CATEGORY_PLAYBACK,
      playback: {
        campaignId: 'campaign-001',
        mediaId: 'media-001',
        durationMs: 5000,
        completed: true,
        ...overrides,
      },
    };
  }

  /**
   * Create an error event
   */
  static createErrorEvent(overrides?: Partial<ErrorEvent>): AnalyticsEvent {
    return {
      eventId: this.generateEventId(),
      timestampMs: Date.now(),
      category: EventCategory.EVENT_CATEGORY_ERROR,
      error: {
        errorType: 'NETWORK_ERROR',
        message: 'Failed to download media',
        stackTrace: 'Error: Failed to download\n    at DownloadManager.download',
        component: 'DownloadManager',
        isFatal: false,
        ...overrides,
      },
    };
  }

  /**
   * Create a health event
   */
  static createHealthEvent(overrides?: Partial<HealthEvent>): AnalyticsEvent {
    return {
      eventId: this.generateEventId(),
      timestampMs: Date.now(),
      category: EventCategory.EVENT_CATEGORY_HEALTH,
      health: {
        batteryLevel: 85.5,
        storageFreeBytes: 1024000000,
        cpuUsage: 25.0,
        memoryUsage: 40.0,
        connectionQuality: ConnectionQuality.CONNECTION_QUALITY_GOOD,
        ...overrides,
      },
    };
  }

  /**
   * Create a network context
   */
  static createNetworkContext(overrides?: Partial<NetworkContext>): NetworkContext {
    return {
      quality: ConnectionQuality.CONNECTION_QUALITY_GOOD,
      downloadSpeedMbps: 10.5,
      latencyMs: 50,
      ...overrides,
    };
  }

  /**
   * Create a queue status
   */
  static createQueueStatus(overrides?: Partial<QueueStatus>): QueueStatus {
    return {
      pendingCount: 10,
      oldestEventHours: 2,
      ...overrides,
    };
  }

  /**
   * Create a complete analytics batch
   */
  static createBatch(
    deviceId: string,
    options?: {
      eventCount?: number;
      eventTypes?: ('playback' | 'error' | 'health')[];
      networkQuality?: ConnectionQuality;
    },
  ): AnalyticsBatch {
    const eventCount = options?.eventCount ?? 5;
    const eventTypes = options?.eventTypes ?? ['playback'];
    const events: AnalyticsEvent[] = [];

    for (let i = 0; i < eventCount; i++) {
      const type = eventTypes[i % eventTypes.length];
      switch (type) {
        case 'playback':
          events.push(this.createPlaybackEvent());
          break;
        case 'error':
          events.push(this.createErrorEvent());
          break;
        case 'health':
          events.push(this.createHealthEvent());
          break;
      }
    }

    return {
      deviceId,
      batchId: this.generateBatchId(),
      timestampMs: Date.now(),
      events,
      networkContext: this.createNetworkContext({
        quality: options?.networkQuality ?? ConnectionQuality.CONNECTION_QUALITY_GOOD,
      }),
      queueStatus: this.createQueueStatus(),
    };
  }

  /**
   * Create a batch with mixed event types
   */
  static createMixedBatch(deviceId: string, eventCount = 10): AnalyticsBatch {
    return this.createBatch(deviceId, {
      eventCount,
      eventTypes: ['playback', 'error', 'health'],
    });
  }

  /**
   * Create a batch with only playback events
   */
  static createPlaybackBatch(deviceId: string, eventCount = 5): AnalyticsBatch {
    return this.createBatch(deviceId, {
      eventCount,
      eventTypes: ['playback'],
    });
  }

  /**
   * Create a batch with only error events
   */
  static createErrorBatch(deviceId: string, eventCount = 5): AnalyticsBatch {
    return this.createBatch(deviceId, {
      eventCount,
      eventTypes: ['error'],
    });
  }

  /**
   * Create an invalid batch (missing required fields)
   */
  static createInvalidBatch(type: 'missing_device' | 'missing_batch_id' | 'empty_events'): AnalyticsBatch {
    const base = this.createBatch('test-device');

    switch (type) {
      case 'missing_device':
        return { ...base, deviceId: '' };
      case 'missing_batch_id':
        return { ...base, batchId: '' };
      case 'empty_events':
        return { ...base, events: [] };
      default:
        return base;
    }
  }

  /**
   * Create a batch exceeding max size
   */
  static createOversizedBatch(deviceId: string, size = 150): AnalyticsBatch {
    return this.createBatch(deviceId, { eventCount: size });
  }

  /**
   * Sample device IDs for testing
   */
  static readonly SAMPLE_DEVICE_IDS = [
    'device-001',
    'device-002',
    'device-003',
    'android-device-abc123',
    'test-device-fleet',
  ];

  /**
   * Sample campaign IDs for testing
   */
  static readonly SAMPLE_CAMPAIGN_IDS = [
    'campaign-001',
    'campaign-002',
    'campaign-promo-summer',
    'campaign-brand-awareness',
  ];

  /**
   * Sample media IDs for testing
   */
  static readonly SAMPLE_MEDIA_IDS = [
    'media-001',
    'media-002',
    'video-ad-001.mp4',
    'image-banner-002.jpg',
  ];
}

/**
 * Pre-defined fixture data for common test scenarios
 */
export const AnalyticsFixtures = {
  /**
   * Valid batch with 5 playback events
   */
  validPlaybackBatch: AnalyticsFixture.createPlaybackBatch('device-001', 5),

  /**
   * Valid batch with mixed event types
   */
  validMixedBatch: AnalyticsFixture.createMixedBatch('device-002', 6),

  /**
   * Invalid batches for error testing
   */
  invalidBatches: {
    missingDevice: AnalyticsFixture.createInvalidBatch('missing_device'),
    missingBatchId: AnalyticsFixture.createInvalidBatch('missing_batch_id'),
    emptyEvents: AnalyticsFixture.createInvalidBatch('empty_events'),
  },

  /**
   * Batches for different network qualities
   */
  networkBatches: {
    excellent: AnalyticsFixture.createBatch('device-net-001', {
      eventCount: 3,
      networkQuality: ConnectionQuality.CONNECTION_QUALITY_EXCELLENT,
    }),
    good: AnalyticsFixture.createBatch('device-net-002', {
      eventCount: 3,
      networkQuality: ConnectionQuality.CONNECTION_QUALITY_GOOD,
    }),
    fair: AnalyticsFixture.createBatch('device-net-003', {
      eventCount: 3,
      networkQuality: ConnectionQuality.CONNECTION_QUALITY_FAIR,
    }),
    poor: AnalyticsFixture.createBatch('device-net-004', {
      eventCount: 3,
      networkQuality: ConnectionQuality.CONNECTION_QUALITY_POOR,
    }),
    offline: AnalyticsFixture.createBatch('device-net-005', {
      eventCount: 3,
      networkQuality: ConnectionQuality.CONNECTION_QUALITY_OFFLINE,
    }),
  },
};
