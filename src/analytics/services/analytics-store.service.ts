import { Injectable, Logger } from '@nestjs/common';
import type {
  StoredAnalyticsEvent,
  PlaybackRecord,
  ErrorRecord,
  HealthRecord,
  DeviceAnalytics,
} from '../interfaces/analytics.types';

@Injectable()
export class AnalyticsStoreService {
  private readonly logger = new Logger(AnalyticsStoreService.name);
  private readonly events = new Map<string, StoredAnalyticsEvent>();
  private readonly deviceEvents = new Map<string, Set<string>>(); // deviceId -> eventIds

  // Configuration
  private readonly MAX_EVENTS = 50000;
  private readonly TTL_HOURS = 7 * 24; // 7 days

  /**
   * Store multiple events from a batch
   */
  storeEvents(
    deviceId: string,
    batchId: string,
    events: Array<{
      eventId: string;
      timestampMs: number;
      category: 'PLAYBACK' | 'ERROR' | 'HEALTH';
      payload: PlaybackRecord | ErrorRecord | HealthRecord;
    }>,
  ): string[] {
    const now = Date.now();
    const storedIds: string[] = [];

    // Cleanup old events if we're near capacity
    if (this.events.size + events.length > this.MAX_EVENTS) {
      this.cleanupOldEvents();
    }

    for (const event of events) {
      const storedEvent: StoredAnalyticsEvent = {
        eventId: event.eventId,
        deviceId,
        batchId,
        timestampMs: event.timestampMs,
        category: event.category,
        payload: event.payload,
        uploadedAt: now,
      };

      this.events.set(event.eventId, storedEvent);
      storedIds.push(event.eventId);

      // Index by device
      if (!this.deviceEvents.has(deviceId)) {
        this.deviceEvents.set(deviceId, new Set());
      }
      this.deviceEvents.get(deviceId)!.add(event.eventId);
    }

    this.logger.log(
      `Stored ${events.length} events for device ${deviceId} (batch: ${batchId})`,
    );
    return storedIds;
  }

  /**
   * Get events for a specific device
   */
  getEventsForDevice(deviceId: string): StoredAnalyticsEvent[] {
    const eventIds = this.deviceEvents.get(deviceId);
    if (!eventIds) return [];

    const events: StoredAnalyticsEvent[] = [];
    for (const eventId of eventIds) {
      const event = this.events.get(eventId);
      if (event) {
        events.push(event);
      }
    }

    return events.sort((a, b) => b.timestampMs - a.timestampMs);
  }

  /**
   * Get all events (optionally filtered by time range)
   */
  getAllEvents(
    options?: {
      startTimeMs?: number;
      endTimeMs?: number;
      category?: 'PLAYBACK' | 'ERROR' | 'HEALTH';
    },
  ): StoredAnalyticsEvent[] {
    const events = Array.from(this.events.values());

    return events.filter((event) => {
      if (options?.startTimeMs && event.timestampMs < options.startTimeMs) {
        return false;
      }
      if (options?.endTimeMs && event.timestampMs > options.endTimeMs) {
        return false;
      }
      if (options?.category && event.category !== options.category) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get aggregated analytics for a device
   */
  getDeviceAnalytics(deviceId: string): DeviceAnalytics | null {
    const events = this.getEventsForDevice(deviceId);
    if (events.length === 0) return null;

    const playbackCount = events.filter((e) => e.category === 'PLAYBACK').length;
    const errorCount = events.filter((e) => e.category === 'ERROR').length;
    const healthEvents = events.filter((e) => e.category === 'HEALTH');

    const lastHealthSnapshot =
      healthEvents.length > 0
        ? (healthEvents[0].payload as HealthRecord)
        : undefined;

    return {
      deviceId,
      lastSeenAt: Math.max(...events.map((e) => e.timestampMs)),
      totalEvents: events.length,
      playbackCount,
      errorCount,
      lastHealthSnapshot,
    };
  }

  /**
   * Get device IDs that have events
   */
  getDeviceIds(): string[] {
    return Array.from(this.deviceEvents.keys());
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.size;
  }

  /**
   * Clear all events (for testing)
   */
  clear(): void {
    this.events.clear();
    this.deviceEvents.clear();
    this.logger.log('Analytics store cleared');
  }

  /**
   * Get queue status for a device
   */
  getQueueStatus(deviceId: string): { pendingCount: number; oldestEventHours: number } {
    const events = this.getEventsForDevice(deviceId);
    if (events.length === 0) {
      return { pendingCount: 0, oldestEventHours: 0 };
    }

    const oldestEvent = events.reduce((oldest, event) =>
      event.timestampMs < oldest.timestampMs ? event : oldest,
    );

    const oldestEventHours = Math.floor(
      (Date.now() - oldestEvent.timestampMs) / (1000 * 60 * 60),
    );

    return { pendingCount: events.length, oldestEventHours };
  }

  /**
   * Cleanup events older than TTL
   */
  private cleanupOldEvents(): void {
    const cutoffTime = Date.now() - this.TTL_HOURS * 60 * 60 * 1000;
    let cleanedCount = 0;

    for (const [eventId, event] of this.events) {
      if (event.timestampMs < cutoffTime) {
        this.events.delete(eventId);
        this.deviceEvents.get(event.deviceId)?.delete(eventId);
        cleanedCount++;
      }
    }

    // Clean up empty device entries
    for (const [deviceId, eventIds] of this.deviceEvents) {
      if (eventIds.size === 0) {
        this.deviceEvents.delete(deviceId);
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} old events from store`);
    }
  }
}
