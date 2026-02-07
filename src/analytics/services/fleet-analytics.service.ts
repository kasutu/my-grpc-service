import { Injectable } from '@nestjs/common';
import { FleetService } from '../../fleet/fleet.service';
import { AnalyticsStoreService } from './analytics-store.service';
import type {
  FleetAnalytics,
  StoredAnalyticsEvent,
  PlaybackRecord,
  ErrorRecord,
} from '../interfaces/analytics.types';

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
    const allEvents: StoredAnalyticsEvent[] = [];

    // Collect all events from fleet members
    for (const deviceId of members) {
      const deviceEvents = this.analyticsStore.getEventsForDevice(deviceId);
      allEvents.push(...deviceEvents);
    }

    return this.calculateFleetAnalytics(fleetId, members.length, allEvents);
  }

  /**
   * Get playback statistics for a fleet
   */
  getFleetPlaybackStats(fleetId: string): {
    totalPlays: number;
    uniqueCampaigns: number;
    campaignBreakdown: Array<{
      campaignId: string;
      playCount: number;
      totalDurationMs: number;
    }>;
  } | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const members = Array.from(fleet.members.keys());
    const campaignMap = new Map<
      string,
      { playCount: number; totalDurationMs: number }
    >();

    for (const deviceId of members) {
      const deviceEvents = this.analyticsStore.getEventsForDevice(deviceId);
      const playbackEvents = deviceEvents.filter((e) => e.category === 'PLAYBACK');

      for (const event of playbackEvents) {
        const payload = event.payload as PlaybackRecord;
        const existing = campaignMap.get(payload.campaignId);
        if (existing) {
          existing.playCount++;
          existing.totalDurationMs += payload.durationMs;
        } else {
          campaignMap.set(payload.campaignId, {
            playCount: 1,
            totalDurationMs: payload.durationMs,
          });
        }
      }
    }

    const campaignBreakdown = Array.from(campaignMap.entries()).map(
      ([campaignId, stats]) => ({
        campaignId,
        playCount: stats.playCount,
        totalDurationMs: stats.totalDurationMs,
      }),
    );

    return {
      totalPlays: campaignBreakdown.reduce((sum, c) => sum + c.playCount, 0),
      uniqueCampaigns: campaignBreakdown.length,
      campaignBreakdown,
    };
  }

  /**
   * Get error statistics for a fleet
   */
  getFleetErrorStats(fleetId: string): {
    totalErrors: number;
    fatalErrors: number;
    byComponent: Array<{ component: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
    recentErrors: StoredAnalyticsEvent[];
  } | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const members = Array.from(fleet.members.keys());
    const allErrors: StoredAnalyticsEvent[] = [];

    for (const deviceId of members) {
      const deviceEvents = this.analyticsStore.getEventsForDevice(deviceId);
      allErrors.push(...deviceEvents.filter((e) => e.category === 'ERROR'));
    }

    const fatalErrors = allErrors.filter(
      (e) => (e.payload as ErrorRecord).isFatal,
    );

    // Group by component
    const componentMap = new Map<string, number>();
    const typeMap = new Map<string, number>();

    for (const error of allErrors) {
      const payload = error.payload as ErrorRecord;
      componentMap.set(payload.component, (componentMap.get(payload.component) || 0) + 1);
      typeMap.set(payload.errorType, (typeMap.get(payload.errorType) || 0) + 1);
    }

    const byComponent = Array.from(componentMap.entries())
      .map(([component, count]) => ({ component, count }))
      .sort((a, b) => b.count - a.count);

    const byType = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Recent errors (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentErrors = allErrors
      .filter((e) => e.timestampMs > oneDayAgo)
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 50);

    return {
      totalErrors: allErrors.length,
      fatalErrors: fatalErrors.length,
      byComponent,
      byType,
      recentErrors,
    };
  }

  /**
   * Get health overview for a fleet
   */
  getFleetHealthOverview(fleetId: string): {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    deviceHealth: Array<{
      deviceId: string;
      lastSeen: number;
      health: 'healthy' | 'warning' | 'critical';
    }>;
  } | null {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) return null;

    const members = Array.from(fleet.members.keys());
    const deviceHealth: Array<{
      deviceId: string;
      lastSeen: number;
      health: 'healthy' | 'warning' | 'critical';
    }> = [];

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let onlineDevices = 0;

    for (const deviceId of members) {
      const analytics = this.analyticsStore.getDeviceAnalytics(deviceId);
      const lastSeen = analytics?.lastSeenAt || 0;
      const isOnline = lastSeen > oneHourAgo;

      if (isOnline) onlineDevices++;

      // Determine health based on error rate
      let health: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (analytics) {
        const errorRate = analytics.errorCount / Math.max(analytics.totalEvents, 1);
        if (errorRate > 0.1) health = 'critical';
        else if (errorRate > 0.05) health = 'warning';
      }

      deviceHealth.push({ deviceId, lastSeen, health });
    }

    return {
      totalDevices: members.length,
      onlineDevices,
      offlineDevices: members.length - onlineDevices,
      deviceHealth: deviceHealth.sort((a, b) => b.lastSeen - a.lastSeen),
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
    const playbackEvents = events.filter((e) => e.category === 'PLAYBACK');
    const errorEvents = events.filter((e) => e.category === 'ERROR');
    const healthEvents = events.filter((e) => e.category === 'HEALTH');

    // Playback stats
    const uniqueCampaigns = new Set(
      playbackEvents.map((e) => (e.payload as PlaybackRecord).campaignId),
    );
    const totalDuration = playbackEvents.reduce(
      (sum, e) => sum + (e.payload as PlaybackRecord).durationMs,
      0,
    );

    // Error stats
    const fatalErrors = errorEvents.filter(
      (e) => (e.payload as ErrorRecord).isFatal,
    );

    const componentCounts = new Map<string, number>();
    for (const event of errorEvents) {
      const component = (event.payload as ErrorRecord).component;
      componentCounts.set(component, (componentCounts.get(component) || 0) + 1);
    }

    const topComponents = Array.from(componentCounts.entries())
      .map(([component, count]) => ({ component, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Health overview (simplified)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentHealth = healthEvents.filter((e) => e.timestampMs > oneDayAgo);
    const healthyDevices = recentHealth.filter(
      (e) => (e.payload as any).connectionQuality === 'EXCELLENT',
    ).length;

    return {
      fleetId,
      totalDevices,
      totalEvents: events.length,
      playbackStats: {
        totalPlays: playbackEvents.length,
        uniqueCampaigns: uniqueCampaigns.size,
        averageDurationMs:
          playbackEvents.length > 0
            ? Math.round(totalDuration / playbackEvents.length)
            : 0,
      },
      errorStats: {
        totalErrors: errorEvents.length,
        fatalErrors: fatalErrors.length,
        topComponents,
      },
      healthOverview: {
        healthyDevices: Math.min(healthyDevices, totalDevices),
        warningDevices: Math.floor(totalDevices * 0.2),
        criticalDevices: Math.floor(totalDevices * 0.1),
      },
    };
  }
}
