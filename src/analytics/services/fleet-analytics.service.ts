import { Injectable } from '@nestjs/common';
import { FleetService } from '../../fleet/fleet.service';
import { AnalyticsStoreService } from './analytics-store.service';
import type { FleetAnalytics, StoredAnalyticsEvent, EventTypeString } from '../interfaces/analytics.types';
import { EventType } from '../../generated/analytics/v1/analytics';

@Injectable()
export class FleetAnalyticsService {
  constructor(
    private readonly fleetService: FleetService,
    private readonly analyticsStore: AnalyticsStoreService,
  ) {}

  /**
   * Get aggregated analytics for a fleet
   */
  getFleetAnalytics(fleetId: string): FleetAnalytics | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const members = Array.from(fleet.members.keys());
    
    // Get all events from fleet members
    // Note: We need to map device IDs to fingerprints
    // For now, we'll collect events by iterating all stored events
    const allEvents: StoredAnalyticsEvent[] = [];
    const deviceFingerprints = this.analyticsStore.getDeviceFingerprints();
    
    for (const fingerprint of deviceFingerprints) {
      const deviceEvents = this.analyticsStore.getEventsForDevice(fingerprint);
      allEvents.push(...deviceEvents);
    }

    return this.calculateFleetAnalytics(fleetId, members.length, allEvents);
  }

  /**
   * Get events by type for a fleet
   */
  getFleetEventsByType(fleetId: string, type: number): StoredAnalyticsEvent[] | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const allEvents = this.analyticsStore.getAllEvents({ type });
    return allEvents;
  }

  /**
   * Get error events for a fleet
   */
  getFleetErrorEvents(fleetId: string): StoredAnalyticsEvent[] | null {
    return this.getFleetEventsByType(fleetId, 1); // ERROR = 1
  }

  /**
   * Get impression events for a fleet
   */
  getFleetImpressionEvents(fleetId: string): StoredAnalyticsEvent[] | null {
    return this.getFleetEventsByType(fleetId, 2); // IMPRESSION = 2
  }

  /**
   * Get device health overview for a fleet
   */
  getFleetHealthOverview(fleetId: string): {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    deviceHealth: Array<{
      deviceFingerprint: number;
      lastSeen: number;
      health: 'healthy' | 'warning' | 'critical';
    }>;
  } | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const members = Array.from(fleet.members.keys());
    const deviceHealth: Array<{
      deviceFingerprint: number;
      lastSeen: number;
      health: 'healthy' | 'warning' | 'critical';
    }> = [];

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let onlineDevices = 0;

    // Get all device fingerprints
    const fingerprints = this.analyticsStore.getDeviceFingerprints();

    for (const fingerprint of fingerprints) {
      const analytics = this.analyticsStore.getDeviceAnalytics(fingerprint);
      const lastSeen = analytics?.lastSeenAt || 0;
      const isOnline = lastSeen > oneHourAgo;

      if (isOnline) onlineDevices++;

      // Determine health based on error rate
      let health: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (analytics) {
        const errorCount = analytics.eventsByType.ERROR || 0;
        const errorRate = errorCount / Math.max(analytics.totalEvents, 1);
        if (errorRate > 0.1) health = 'critical';
        else if (errorRate > 0.05) health = 'warning';
      }

      deviceHealth.push({ deviceFingerprint: fingerprint, lastSeen, health });
    }

    return {
      totalDevices: members.length,
      onlineDevices,
      offlineDevices: members.length - onlineDevices,
      deviceHealth: deviceHealth.sort((a, b) => b.lastSeen - a.lastSeen),
    };
  }

  /**
   * Get impression summary for a fleet
   */
  getFleetImpressionSummary(fleetId: string): {
    totalImpressions: number;
    uniqueCampaigns: number;
    campaigns: Array<{
      campaignId: string;
      count: number;
      lastSeen: number;
    }>;
  } | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const impressions = this.getFleetImpressionEvents(fleetId);
    if (!impressions) return null;

    const campaignMap = new Map<string, { count: number; lastSeen: number }>();

    for (const event of impressions) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      // v1 schema: c = campaignId
      const campaignId = (payload.c as string) || 'unknown';
      const existing = campaignMap.get(campaignId);
      
      if (existing) {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, event.timestampMs);
      } else {
        campaignMap.set(campaignId, { count: 1, lastSeen: event.timestampMs });
      }
    }

    const campaigns = Array.from(campaignMap.entries()).map(([campaignId, stats]) => ({
      campaignId,
      count: stats.count,
      lastSeen: stats.lastSeen,
    }));

    return {
      totalImpressions: impressions.length,
      uniqueCampaigns: campaigns.length,
      campaigns: campaigns.sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Calculate fleet analytics from events
   */
  private calculateFleetAnalytics(
    fleetId: string,
    totalDevices: number,
    events: StoredAnalyticsEvent[],
  ): FleetAnalytics {
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

    // Recent events (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentEvents = events
      .filter((e) => e.timestampMs > oneDayAgo)
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 100);

    return {
      fleetId,
      totalDevices,
      totalEvents: events.length,
      eventsByType,
      recentEvents,
    };
  }

  /**
   * Get event type string from enum
   */
  private getEventTypeString(type: EventType): EventTypeString {
    switch (type) {
      case EventType.ERROR:
        return 'ERROR';
      case EventType.IMPRESSION:
        return 'IMPRESSION';
      case EventType.HEARTBEAT:
        return 'HEARTBEAT';
      case EventType.PERFORMANCE:
        return 'PERFORMANCE';
      case EventType.LIFECYCLE:
        return 'LIFECYCLE';
      default:
        return 'UNKNOWN';
    }
  }
}
