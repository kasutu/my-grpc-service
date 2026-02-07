import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import * as cbor from 'cbor';
import { AnalyticsStoreService } from './services/analytics-store.service';
import { AnalyticsService } from './analytics.service';
import type { Batch, Event } from '../generated/analytics/v1/analytics';
import { EventType, ConnectionQuality } from '../generated/analytics/v1/analytics';

@Controller('analytics')
export class AnalyticsHttpController {
  private safeDate(timestampMs: number | undefined | null): string {
    if (!timestampMs || typeof timestampMs !== 'number' || isNaN(timestampMs)) {
      return new Date().toISOString();
    }
    try {
      return new Date(timestampMs).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsStore: AnalyticsStoreService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Event Ingestion
  // ─────────────────────────────────────────────────────────────

  /**
   * Submit events via HTTP (auto-creates batch)
   * Accepts JSON events that will be encoded to CBOR
   */
  @Post('ingest/:deviceFingerprint')
  @HttpCode(201)
  async ingestEvents(
    @Param('deviceFingerprint') deviceFingerprintStr: string,
    @Body()
    body: {
      events: Array<{
        event_id: string; // hex string of 16-byte UUID
        timestamp_ms: number;
        type: string; // 'ERROR' | 'IMPRESSION' | 'HEARTBEAT' | 'PERFORMANCE' | 'LIFECYCLE'
        schema_version?: number;
        payload: unknown; // Will be CBOR encoded
        network?: {
          quality: string; // 'OFFLINE' | 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT'
          download_mbps?: number;
          upload_mbps?: number;
          connection_type?: string;
          signal_strength_dbm?: number;
        };
      }>;
      queue?: {
        pending_events?: number;
        oldest_event_age_hours?: number;
        is_backpressure?: boolean;
      };
    },
  ) {
    const deviceFingerprint = parseInt(deviceFingerprintStr, 10);
    if (isNaN(deviceFingerprint)) {
      throw new HttpException('Invalid device fingerprint', HttpStatus.BAD_REQUEST);
    }

    // Generate batch ID
    const batchId = Buffer.from(this.generateUuid());

    // Convert JSON events to proto Events with CBOR payloads
    const events: Event[] = [];
    const rejectedEvents: string[] = [];

    for (const eventData of body.events ?? []) {
      try {
        // Convert event_id from hex to bytes
        const eventId = Buffer.from(eventData.event_id.replace(/-/g, ''), 'hex');
        if (eventId.length !== 16) {
          rejectedEvents.push(eventData.event_id);
          continue;
        }

        // Encode payload to CBOR
        const payload = cbor.encode(eventData.payload);

        // Convert type string to enum
        const type = this.parseEventType(eventData.type);

        // Parse schema version (default to 1.0.0 = 0x00010000)
        const schemaVersion = eventData.schema_version ?? 0x00010000;

        // Parse network context
        const network = eventData.network
          ? {
              quality: this.parseConnectionQuality(eventData.network.quality),
              downloadMbps: eventData.network.download_mbps ?? 0,
              uploadMbps: eventData.network.upload_mbps ?? 0,
              connectionType: eventData.network.connection_type ?? '',
              signalStrengthDbm: eventData.network.signal_strength_dbm ?? 0,
            }
          : undefined;

        events.push({
          eventId,
          timestampMs: eventData.timestamp_ms ?? Date.now(),
          type,
          schemaVersion,
          payload,
          network,
        });
      } catch (error) {
        rejectedEvents.push(eventData.event_id);
      }
    }

    // Create batch
    const batch: Batch = {
      batchId,
      events,
      deviceFingerprint,
      queue: body.queue
        ? {
            pendingEvents: body.queue.pending_events ?? 0,
            oldestEventAgeHours: body.queue.oldest_event_age_hours ?? 0,
            isBackpressure: body.queue.is_backpressure ?? false,
          }
        : undefined,
      sentAtMs: Date.now(),
    };

    // Process batch
    const result = this.analyticsService.ingest(batch);

    return {
      accepted: result.accepted,
      batch_id: batchId.toString('hex'),
      events_received: body.events?.length ?? 0,
      events_stored: events.length,
      rejected_event_ids: rejectedEvents,
      policy: result.policy
        ? {
            min_quality: result.policy.minQuality,
            max_batch_size: result.policy.maxBatchSize,
            max_queue_age_hours: result.policy.maxQueueAgeHours,
            upload_interval_seconds: result.policy.uploadIntervalSeconds,
          }
        : undefined,
    };
  }

  /**
   * Get server upload policy
   */
  @Get('policy')
  getPolicy() {
    const policy = this.analyticsService.getPolicy();
    return {
      min_quality: policy.minQuality,
      max_batch_size: policy.maxBatchSize,
      max_queue_age_hours: policy.maxQueueAgeHours,
      upload_interval_seconds: policy.uploadIntervalSeconds,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Event Querying
  // ─────────────────────────────────────────────────────────────

  /**
   * Query events with filters
   */
  @Get('events')
  queryEvents(
    @Query('device_fingerprint') deviceFingerprintStr?: string,
    @Query('type') typeStr?: string,
    @Query('from') fromTimestamp?: string,
    @Query('to') toTimestamp?: string,
    @Query('limit') limitStr?: string,
  ) {
    const deviceFingerprint = deviceFingerprintStr ? parseInt(deviceFingerprintStr, 10) : undefined;
    const type = typeStr ? this.parseEventType(typeStr) : undefined;
    const startTimeMs = fromTimestamp ? parseInt(fromTimestamp, 10) : undefined;
    const endTimeMs = toTimestamp ? parseInt(toTimestamp, 10) : undefined;
    const limit = parseInt(limitStr || '100', 10);

    let events = this.analyticsStore.getAllEvents({
      deviceFingerprint,
      type,
      startTimeMs,
      endTimeMs,
    });

    events = events.slice(0, limit);

    return {
      total: events.length,
      events: events.map((e) => ({
        eventId: e.eventId,
        deviceFingerprint: e.deviceFingerprint,
        batchId: e.batchId,
        timestamp: this.safeDate(e.timestampMs),
        type: this.analyticsService.getEventTypeString(e.type),
        schemaVersion: this.formatSchemaVersion(e.schemaVersion),
        payload: e.payload,
        network: e.network,
      })),
    };
  }

  /**
   * Get a single event by ID
   */
  @Get('events/:eventId')
  getEvent(@Param('eventId') eventId: string) {
    const event = this.analyticsStore.getEvent(eventId);
    if (!event) {
      throw new HttpException('Event not found', HttpStatus.NOT_FOUND);
    }

    return {
      eventId: event.eventId,
      deviceFingerprint: event.deviceFingerprint,
      batchId: event.batchId,
      timestamp: this.safeDate(event.timestampMs),
      type: this.analyticsService.getEventTypeString(event.type),
      schemaVersion: this.formatSchemaVersion(event.schemaVersion),
      payload: event.payload,
      network: event.network,
      receivedAt: this.safeDate(event.receivedAt),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Device Analytics
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all events for a specific device
   */
  @Get('devices/:deviceFingerprint/events')
  getDeviceEvents(
    @Param('deviceFingerprint') deviceFingerprintStr: string,
    @Query('type') typeStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const deviceFingerprint = parseInt(deviceFingerprintStr, 10);
    if (isNaN(deviceFingerprint)) {
      throw new HttpException('Invalid device fingerprint', HttpStatus.BAD_REQUEST);
    }

    const type = typeStr ? this.parseEventType(typeStr) : undefined;
    let events = this.analyticsStore.getEventsForDevice(deviceFingerprint);

    if (type !== undefined) {
      events = events.filter((e) => e.type === type);
    }

    const limit = parseInt(limitStr || '100', 10);
    events = events.slice(0, limit);

    return {
      deviceFingerprint,
      totalEvents: events.length,
      events: events.map((e) => ({
        eventId: e.eventId,
        batchId: e.batchId,
        timestamp: this.safeDate(e.timestampMs),
        type: this.analyticsService.getEventTypeString(e.type),
        payload: e.payload,
      })),
    };
  }

  /**
   * Get analytics summary for a device
   */
  @Get('devices/:deviceFingerprint/summary')
  getDeviceSummary(@Param('deviceFingerprint') deviceFingerprintStr: string) {
    const deviceFingerprint = parseInt(deviceFingerprintStr, 10);
    if (isNaN(deviceFingerprint)) {
      throw new HttpException('Invalid device fingerprint', HttpStatus.BAD_REQUEST);
    }

    const analytics = this.analyticsStore.getDeviceAnalytics(deviceFingerprint);

    if (!analytics) {
      throw new HttpException('No analytics data found for device', HttpStatus.NOT_FOUND);
    }

    return {
      deviceFingerprint: analytics.deviceFingerprint,
      lastSeen: this.safeDate(analytics.lastSeenAt),
      totalEvents: analytics.totalEvents,
      eventsByType: analytics.eventsByType,
      lastNetworkQuality: analytics.lastNetworkQuality
        ? this.analyticsService.getConnectionQualityString(analytics.lastNetworkQuality)
        : undefined,
    };
  }

  /**
   * List all devices with analytics data
   */
  @Get('devices')
  getDevicesWithAnalytics() {
    const fingerprints = this.analyticsStore.getDeviceFingerprints();
    const devices = fingerprints.map((fingerprint) => {
      const analytics = this.analyticsStore.getDeviceAnalytics(fingerprint);
      return {
        deviceFingerprint: fingerprint,
        lastSeen: analytics ? this.safeDate(analytics.lastSeenAt) : null,
        totalEvents: analytics?.totalEvents || 0,
        eventsByType: analytics?.eventsByType || {
          ERROR: 0,
          IMPRESSION: 0,
          HEARTBEAT: 0,
          PERFORMANCE: 0,
          LIFECYCLE: 0,
          UNKNOWN: 0,
        },
      };
    });

    return {
      total: devices.length,
      devices: devices.sort(
        (a, b) => new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime(),
      ),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Global Analytics
  // ─────────────────────────────────────────────────────────────

  /**
   * Get global analytics summary
   */
  @Get('summary')
  getGlobalSummary() {
    const deviceFingerprints = this.analyticsStore.getDeviceFingerprints();
    const totalEvents = this.analyticsStore.getEventCount();

    return {
      totalDevices: deviceFingerprints.length,
      totalEvents,
      storageLimit: 50000,
      storageUsagePercent: Math.round((totalEvents / 50000) * 100),
    };
  }

  /**
   * Get global event counts by type
   */
  @Get('stats')
  getGlobalStats() {
    const events = this.analyticsStore.getAllEvents();
    const stats = {
      ERROR: 0,
      IMPRESSION: 0,
      HEARTBEAT: 0,
      PERFORMANCE: 0,
      LIFECYCLE: 0,
      UNKNOWN: 0,
    };

    for (const event of events) {
      const typeStr = this.analyticsService.getEventTypeString(event.type);
      stats[typeStr as keyof typeof stats]++;
    }

    return {
      totalEvents: events.length,
      byType: stats,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Parse event type string to enum
   */
  private parseEventType(type: string): EventType {
    const map: Record<string, EventType> = {
      UNSPECIFIED: EventType.EVENT_TYPE_UNSPECIFIED,
      ERROR: EventType.ERROR,
      IMPRESSION: EventType.IMPRESSION,
      HEARTBEAT: EventType.HEARTBEAT,
      PERFORMANCE: EventType.PERFORMANCE,
      LIFECYCLE: EventType.LIFECYCLE,
    };
    return map[type?.toUpperCase()] ?? EventType.EVENT_TYPE_UNSPECIFIED;
  }

  /**
   * Parse connection quality string to enum
   */
  private parseConnectionQuality(quality: string): ConnectionQuality {
    const map: Record<string, ConnectionQuality> = {
      UNSPECIFIED: ConnectionQuality.CONNECTION_QUALITY_UNSPECIFIED,
      OFFLINE: ConnectionQuality.OFFLINE,
      POOR: ConnectionQuality.POOR,
      FAIR: ConnectionQuality.FAIR,
      GOOD: ConnectionQuality.GOOD,
      EXCELLENT: ConnectionQuality.EXCELLENT,
    };
    return map[quality?.toUpperCase()] ?? ConnectionQuality.CONNECTION_QUALITY_UNSPECIFIED;
  }

  /**
   * Generate a UUID as hex string
   */
  private generateUuid(): string {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Buffer.from(bytes).toString('hex');
  }

  /**
   * Format schema version from integer to string
   * 0x00MMmmPP -> major.minor.patch
   */
  private formatSchemaVersion(version: number): string {
    const major = (version >> 16) & 0xff;
    const minor = (version >> 8) & 0xff;
    const patch = version & 0xff;
    return `${major}.${minor}.${patch}`;
  }
}
