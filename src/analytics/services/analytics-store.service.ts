import { Injectable, Logger } from "@nestjs/common";
import type {
  StoredAnalyticsEvent,
  DeviceAnalytics,
  EventTypeString,
} from "../interfaces/analytics.types";
import { EventType } from "../../generated/analytics/v1/analytics";

@Injectable()
export class AnalyticsStoreService {
  private readonly logger = new Logger(AnalyticsStoreService.name);
  private readonly events = new Map<string, StoredAnalyticsEvent>();
  private readonly deviceEvents = new Map<number, Set<string>>(); // deviceFingerprint -> eventIds

  // Configuration
  private readonly MAX_EVENTS = 50000;
  private readonly TTL_HOURS = 7 * 24; // 7 days

  /**
   * Store multiple events from a batch
   */
  storeEvents(
    batchId: string,
    events: Array<{
      eventId: string;
      deviceFingerprint: number;
      batchId: string;
      timestampMs: number;
      type: number;
      schemaVersion: number;
      payload: unknown;
      network?: {
        quality: number;
        downloadMbps?: number;
        uploadMbps?: number;
        connectionType?: string;
        signalStrengthDbm?: number;
      };
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
        deviceFingerprint: event.deviceFingerprint,
        batchId: event.batchId,
        timestampMs: event.timestampMs,
        type: event.type,
        schemaVersion: event.schemaVersion,
        payload: event.payload,
        network: event.network,
        receivedAt: now,
      };

      this.events.set(event.eventId, storedEvent);
      storedIds.push(event.eventId);

      // Index by device fingerprint
      if (!this.deviceEvents.has(event.deviceFingerprint)) {
        this.deviceEvents.set(event.deviceFingerprint, new Set());
      }
      this.deviceEvents.get(event.deviceFingerprint)!.add(event.eventId);
    }

    this.logger.log(`Stored ${events.length} events from batch ${batchId}`);
    return storedIds;
  }

  /**
   * Get events for a specific device
   */
  getEventsForDevice(deviceFingerprint: number): StoredAnalyticsEvent[] {
    const eventIds = this.deviceEvents.get(deviceFingerprint);
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
   * Get all events with optional filters
   */
  getAllEvents(options?: {
    deviceFingerprint?: number;
    type?: number;
    startTimeMs?: number;
    endTimeMs?: number;
  }): StoredAnalyticsEvent[] {
    let events = Array.from(this.events.values());

    if (options?.deviceFingerprint !== undefined) {
      events = events.filter(
        (e) => e.deviceFingerprint === options.deviceFingerprint,
      );
    }

    if (options?.type !== undefined) {
      events = events.filter((e) => e.type === options.type);
    }

    if (options?.startTimeMs !== undefined) {
      events = events.filter((e) => e.timestampMs >= options.startTimeMs!);
    }

    if (options?.endTimeMs !== undefined) {
      events = events.filter((e) => e.timestampMs <= options.endTimeMs!);
    }

    return events.sort((a, b) => b.timestampMs - a.timestampMs);
  }

  /**
   * Get aggregated analytics for a device
   */
  getDeviceAnalytics(deviceFingerprint: number): DeviceAnalytics | null {
    const events = this.getEventsForDevice(deviceFingerprint);
    if (events.length === 0) return null;

    const eventsByType: Record<EventTypeString, number> = {
      ERROR: 0,
      IMPRESSION: 0,
      HEARTBEAT: 0,
      PERFORMANCE: 0,
      LIFECYCLE: 0,
      UNKNOWN: 0,
    };

    for (const event of events) {
      const typeStr = this.getEventTypeString(event.type);
      eventsByType[typeStr]++;
    }

    const lastEvent = events[0]; // Already sorted by timestamp desc
    const lastNetworkQuality = lastEvent.network?.quality;

    return {
      deviceFingerprint,
      lastSeenAt: lastEvent.timestampMs,
      totalEvents: events.length,
      eventsByType,
      lastNetworkQuality,
    };
  }

  /**
   * Get all device fingerprints that have events
   */
  getDeviceFingerprints(): number[] {
    return Array.from(this.deviceEvents.keys());
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.size;
  }

  /**
   * Get event by ID
   */
  getEvent(eventId: string): StoredAnalyticsEvent | undefined {
    return this.events.get(eventId);
  }

  /**
   * Clear all events (for testing)
   */
  clear(): void {
    this.events.clear();
    this.deviceEvents.clear();
    this.logger.log("Analytics store cleared");
  }

  /**
   * Get event type string from enum
   */
  private getEventTypeString(type: EventType): EventTypeString {
    switch (type) {
      case EventType.ERROR:
        return "ERROR";
      case EventType.IMPRESSION:
        return "IMPRESSION";
      case EventType.HEARTBEAT:
        return "HEARTBEAT";
      case EventType.PERFORMANCE:
        return "PERFORMANCE";
      case EventType.LIFECYCLE:
        return "LIFECYCLE";
      default:
        return "UNKNOWN";
    }
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
        this.deviceEvents.get(event.deviceFingerprint)?.delete(eventId);
        cleanedCount++;
      }
    }

    // Clean up empty device entries
    for (const [deviceFingerprint, eventIds] of this.deviceEvents) {
      if (eventIds.size === 0) {
        this.deviceEvents.delete(deviceFingerprint);
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} old events from store`);
    }
  }
}
