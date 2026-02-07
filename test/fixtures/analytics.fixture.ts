import type {
  Batch,
  Event,
  NetworkContext,
  QueueStatus,
} from '../../src/generated/analytics/v1/analytics';
import { EventType, ConnectionQuality } from '../../src/generated/analytics/v1/analytics';

/**
 * Fixture utilities for analytics v2 testing
 * Uses minimal envelope + CBOR payload design
 */
export class AnalyticsFixture {
  private static eventIdCounter = 0;
  private static batchIdCounter = 0;

  /**
   * Generate a 16-byte UUID as Buffer
   */
  static generateUuidBytes(): Buffer {
    const bytes = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes;
  }

  /**
   * Generate a hex UUID string
   */
  static generateUuid(): string {
    return this.generateUuidBytes().toString('hex');
  }

  /**
   * Generate a unique event ID (hex string)
   */
  static generateEventId(): string {
    return `evt-${Date.now()}-${++this.eventIdCounter}`;
  }

  /**
   * Generate a 16-byte event ID as Buffer
   */
  static generateEventIdBytes(): Buffer {
    return this.generateUuidBytes();
  }

  /**
   * Generate a unique batch ID (hex string)
   */
  static generateBatchId(): string {
    return `batch-${Date.now()}-${++this.batchIdCounter}`;
  }

  /**
   * Generate a 16-byte batch ID as Buffer
   */
  static generateBatchIdBytes(): Buffer {
    return this.generateUuidBytes();
  }

  /**
   * Create a CBOR payload for impression event (v1 schema)
   */
  static createImpressionPayload(options?: {
    campaignId?: string;
    playCount?: number;
    lastPlayedAt?: number;
    totalPlayTimeMs?: number;
    lastMediaId?: string;
  }): Record<string, unknown> {
    return {
      c: options?.campaignId ?? 'campaign-001',  // campaignId
      p: options?.playCount ?? 1,                 // playCount
      t: options?.lastPlayedAt ?? Date.now(),     // lastPlayedAt timestamp
      d: options?.totalPlayTimeMs ?? 5000,        // totalPlayTime
      m: options?.lastMediaId ?? 'media-001',     // lastMediaId
      v: 1,                                       // schema version
    };
  }

  /**
   * Create a CBOR payload for error event (v1 schema)
   */
  static createErrorPayload(options?: {
    code?: string;
    message?: string;
    component?: string;
    fatal?: boolean;
  }): Record<string, unknown> {
    return {
      code: options?.code ?? 'NETWORK_ERROR',
      msg: options?.message ?? 'Failed to download media',
      component: options?.component ?? 'DownloadManager',
      fatal: options?.fatal ?? false,
      v: 1,
    };
  }

  /**
   * Create a CBOR payload for heartbeat event (v1 schema)
   */
  static createHeartbeatPayload(options?: {
    uptime?: number;
    battery?: number;
  }): Record<string, unknown> {
    return {
      uptime: options?.uptime ?? 3600000,  // 1 hour in ms
      battery: options?.battery ?? 85,
      v: 1,
    };
  }

  /**
   * Create a CBOR payload for performance event (v1 schema)
   */
  static createPerformancePayload(options?: {
    cpu?: number;
    memory?: number;
    fps?: number;
  }): Record<string, unknown> {
    return {
      cpu: options?.cpu ?? 25.0,
      memory: options?.memory ?? 40.0,
      fps: options?.fps ?? 60,
      v: 1,
    };
  }

  /**
   * Create a CBOR payload for lifecycle event (v1 schema)
   */
  static createLifecyclePayload(options?: {
    action?: string;
    prevState?: string;
  }): Record<string, unknown> {
    return {
      action: options?.action ?? 'app_start',
      prevState: options?.prevState,
      v: 1,
    };
  }

  /**
   * Create an analytics v2 event
   */
  static createEvent(options?: {
    type?: EventType;
    schemaVersion?: number;
    payload?: Record<string, unknown>;
    networkQuality?: ConnectionQuality;
  }): Event {
    return {
      eventId: this.generateEventIdBytes(),
      timestampMs: Date.now(),
      type: options?.type ?? EventType.IMPRESSION,
      schemaVersion: options?.schemaVersion ?? 0x00010000,  // v1.0.0
      payload: Buffer.from(JSON.stringify(options?.payload ?? this.createImpressionPayload())),
      network: options?.networkQuality !== undefined ? {
        quality: options.networkQuality,
        downloadMbps: 10.5,
        uploadMbps: 5.0,
        connectionType: 'wifi',
        signalStrengthDbm: -50,
      } : undefined,
    };
  }

  /**
   * Create an impression event
   */
  static createImpressionEvent(options?: {
    campaignId?: string;
    playCount?: number;
    networkQuality?: ConnectionQuality;
  }): Event {
    return this.createEvent({
      type: EventType.IMPRESSION,
      payload: this.createImpressionPayload({
        campaignId: options?.campaignId,
        playCount: options?.playCount,
      }),
      networkQuality: options?.networkQuality,
    });
  }

  /**
   * Create an error event
   */
  static createErrorEvent(options?: {
    code?: string;
    message?: string;
    fatal?: boolean;
    networkQuality?: ConnectionQuality;
  }): Event {
    return this.createEvent({
      type: EventType.ERROR,
      payload: this.createErrorPayload({
        code: options?.code,
        message: options?.message,
        fatal: options?.fatal,
      }),
      networkQuality: options?.networkQuality,
    });
  }

  /**
   * Create a heartbeat event
   */
  static createHeartbeatEvent(options?: {
    uptime?: number;
    battery?: number;
    networkQuality?: ConnectionQuality;
  }): Event {
    return this.createEvent({
      type: EventType.HEARTBEAT,
      payload: this.createHeartbeatPayload({
        uptime: options?.uptime,
        battery: options?.battery,
      }),
      networkQuality: options?.networkQuality,
    });
  }

  /**
   * Create a network context
   */
  static createNetworkContext(overrides?: Partial<NetworkContext>): NetworkContext {
    return {
      quality: ConnectionQuality.GOOD,
      downloadMbps: 10.5,
      uploadMbps: 5.0,
      connectionType: 'wifi',
      signalStrengthDbm: -50,
      ...overrides,
    };
  }

  /**
   * Create a queue status
   */
  static createQueueStatus(overrides?: Partial<QueueStatus>): QueueStatus {
    return {
      pendingEvents: 10,
      oldestEventAgeHours: 2,
      isBackpressure: false,
      ...overrides,
    };
  }

  /**
   * Create a complete analytics v2 batch
   */
  static createBatch(
    deviceFingerprint: number,
    options?: {
      eventCount?: number;
      eventTypes?: ('impression' | 'error' | 'heartbeat' | 'performance' | 'lifecycle')[];
      networkQuality?: ConnectionQuality;
    },
  ): Batch {
    const eventCount = options?.eventCount ?? 5;
    const eventTypes = options?.eventTypes ?? ['impression'];
    const events: Event[] = [];

    for (let i = 0; i < eventCount; i++) {
      const type = eventTypes[i % eventTypes.length];
      switch (type) {
        case 'impression':
          events.push(this.createImpressionEvent({ networkQuality: options?.networkQuality }));
          break;
        case 'error':
          events.push(this.createErrorEvent({ networkQuality: options?.networkQuality }));
          break;
        case 'heartbeat':
          events.push(this.createHeartbeatEvent({ networkQuality: options?.networkQuality }));
          break;
        case 'performance':
          events.push(this.createEvent({
            type: EventType.PERFORMANCE,
            payload: this.createPerformancePayload(),
            networkQuality: options?.networkQuality,
          }));
          break;
        case 'lifecycle':
          events.push(this.createEvent({
            type: EventType.LIFECYCLE,
            payload: this.createLifecyclePayload(),
            networkQuality: options?.networkQuality,
          }));
          break;
      }
    }

    return {
      batchId: this.generateBatchIdBytes(),
      events,
      deviceFingerprint,
      queue: this.createQueueStatus(),
      sentAtMs: Date.now(),
    };
  }

  /**
   * Create a batch with mixed event types
   */
  static createMixedBatch(deviceFingerprint: number, eventCount = 10): Batch {
    return this.createBatch(deviceFingerprint, {
      eventCount,
      eventTypes: ['impression', 'error', 'heartbeat'],
    });
  }

  /**
   * Create a batch with only impression events
   */
  static createImpressionBatch(deviceFingerprint: number, eventCount = 5): Batch {
    return this.createBatch(deviceFingerprint, {
      eventCount,
      eventTypes: ['impression'],
    });
  }

  /**
   * Create a batch with only error events
   */
  static createErrorBatch(deviceFingerprint: number, eventCount = 5): Batch {
    return this.createBatch(deviceFingerprint, {
      eventCount,
      eventTypes: ['error'],
    });
  }

  /**
   * Create an invalid batch (missing required fields)
   */
  static createInvalidBatch(type: 'missing_fingerprint' | 'missing_batch_id' | 'empty_events'): Batch {
    const base = this.createBatch(12345);

    switch (type) {
      case 'missing_fingerprint':
        return { ...base, deviceFingerprint: 0 };
      case 'missing_batch_id':
        return { ...base, batchId: Buffer.alloc(0) };
      case 'empty_events':
        return { ...base, events: [] };
      default:
        return base;
    }
  }

  /**
   * Create a batch exceeding max size
   */
  static createOversizedBatch(deviceFingerprint: number, size = 150): Batch {
    return this.createBatch(deviceFingerprint, { eventCount: size });
  }

  /**
   * Sample device fingerprints for testing
   */
  static readonly SAMPLE_DEVICE_FINGERPRINTS = [
    0x12345678,
    0xabcdef01,
    0x99998888,
    0x11111111,
    0xdeadbeef,
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
   * Valid batch with 5 impression events
   */
  validImpressionBatch: AnalyticsFixture.createImpressionBatch(0x12345678, 5),

  /**
   * Valid batch with mixed event types
   */
  validMixedBatch: AnalyticsFixture.createMixedBatch(0xabcdef01, 6),

  /**
   * Invalid batches for error testing
   */
  invalidBatches: {
    missingFingerprint: AnalyticsFixture.createInvalidBatch('missing_fingerprint'),
    missingBatchId: AnalyticsFixture.createInvalidBatch('missing_batch_id'),
    emptyEvents: AnalyticsFixture.createInvalidBatch('empty_events'),
  },

  /**
   * Batches for different network qualities
   */
  networkBatches: {
    excellent: AnalyticsFixture.createBatch(0x11111111, {
      eventCount: 3,
      networkQuality: ConnectionQuality.EXCELLENT,
    }),
    good: AnalyticsFixture.createBatch(0x22222222, {
      eventCount: 3,
      networkQuality: ConnectionQuality.GOOD,
    }),
    fair: AnalyticsFixture.createBatch(0x33333333, {
      eventCount: 3,
      networkQuality: ConnectionQuality.FAIR,
    }),
    poor: AnalyticsFixture.createBatch(0x44444444, {
      eventCount: 3,
      networkQuality: ConnectionQuality.POOR,
    }),
    offline: AnalyticsFixture.createBatch(0x55555555, {
      eventCount: 3,
      networkQuality: ConnectionQuality.OFFLINE,
    }),
  },
};
