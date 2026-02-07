import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AnalyticsStoreService } from './services/analytics-store.service';
import { FleetAnalyticsService } from './services/fleet-analytics.service';
import { FleetService } from '../fleet/fleet.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsMapper } from './interfaces/analytics.mapper';

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
    private readonly fleetAnalytics: FleetAnalyticsService,
    private readonly fleetService: FleetService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Event Submission
  // ─────────────────────────────────────────────────────────────

  /**
   * Submit events via HTTP (auto-creates batch)
   */
  @Post('events/:deviceId')
  async submitEvents(
    @Param('deviceId') deviceId: string,
    @Body()
    body: {
      events: Array<{
        event_id: string;
        timestamp_ms: number;
        category: string;
        playback?: {
          campaign_id: string;
          media_id: string;
          duration_ms: number;
          completed: boolean;
        };
        error?: {
          error_type: string;
          message: string;
          component: string;
          is_fatal: boolean;
        };
        health?: {
          battery_level: number;
          storage_free_bytes: number;
          cpu_usage: number;
          memory_usage: number;
          connection_quality: number;
        };
      }>;
      network_context?: {
        quality: number;
        download_speed_mbps: number;
        latency_ms: number;
      };
      queue_status?: {
        pending_count: number;
        oldest_event_hours: number;
      };
    },
  ) {
    const batch = AnalyticsMapper.toAnalyticsBatch({
      device_id: deviceId,
      batch_id: `http-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp_ms: Date.now(),
      events: body.events ?? [],
      network_context: body.network_context,
      queue_status: body.queue_status,
    });

    const result = this.analyticsService.uploadBatch(batch);

    return {
      accepted: result.accepted,
      batch_id: result.batchId,
      events_received: body.events?.length ?? 0,
      failed_event_ids: result.failedEventIds,
      policy: result.policy
        ? {
            max_batch_size: result.policy.maxBatchSize,
            sync_interval_seconds: result.policy.syncIntervalSeconds,
          }
        : undefined,
    };
  }

  /**
   * Query events with filters
   */
  @Get('events')
  queryEvents(
    @Query('device_id') deviceId?: string,
    @Query('category') category?: string,
    @Query('from') fromTimestamp?: string,
    @Query('to') toTimestamp?: string,
  ) {
    let events = this.analyticsStore.getAllEvents();

    if (deviceId) {
      events = events.filter((e) => e.deviceId === deviceId);
    }

    if (category) {
      events = events.filter((e) => e.category === category);
    }

    if (fromTimestamp) {
      const from = parseInt(fromTimestamp, 10);
      events = events.filter((e) => e.timestampMs >= from);
    }

    if (toTimestamp) {
      const to = parseInt(toTimestamp, 10);
      events = events.filter((e) => e.timestampMs <= to);
    }

    // Sort by timestamp descending
    events.sort((a, b) => b.timestampMs - a.timestampMs);

    return {
      total: events.length,
      events: events.map((e) => ({
        eventId: e.eventId,
        deviceId: e.deviceId,
        batchId: e.batchId,
        timestamp: this.safeDate(e.timestampMs),
        category: e.category,
        payload: e.payload,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Device Analytics
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all events for a specific device
   */
  @Get('devices/:deviceId/events')
  getDeviceEvents(
    @Param('deviceId') deviceId: string,
    @Query('category') category?: 'PLAYBACK' | 'ERROR' | 'HEALTH',
    @Query('limit') limitStr?: string,
  ) {
    let events = this.analyticsStore.getEventsForDevice(deviceId);

    if (category) {
      events = events.filter((e) => e.category === category);
    }

    const limit = parseInt(limitStr || '100', 10);
    events = events.slice(0, limit);

    return {
      deviceId,
      totalEvents: events.length,
      events: events.map((e) => ({
        eventId: e.eventId,
        batchId: e.batchId,
        timestamp: this.safeDate(e.timestampMs),
        category: e.category,
        payload: e.payload,
      })),
    };
  }

  /**
   * Get analytics summary for a device
   */
  @Get('devices/:deviceId/summary')
  getDeviceSummary(@Param('deviceId') deviceId: string) {
    const analytics = this.analyticsStore.getDeviceAnalytics(deviceId);

    if (!analytics) {
      throw new HttpException(
        'No analytics data found for device',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      deviceId: analytics.deviceId,
      lastSeen: this.safeDate(analytics.lastSeenAt),
      totalEvents: analytics.totalEvents,
      playbackCount: analytics.playbackCount,
      errorCount: analytics.errorCount,
      lastHealthSnapshot: analytics.lastHealthSnapshot,
    };
  }

  /**
   * Get queue status for a device
   */
  @Get('devices/:deviceId/queue')
  getDeviceQueue(@Param('deviceId') deviceId: string) {
    const status = this.analyticsStore.getQueueStatus(deviceId);
    return {
      deviceId,
      ...status,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Fleet Analytics
  // ─────────────────────────────────────────────────────────────

  /**
   * Get full analytics for a fleet
   */
  @Get('fleets/:fleetId')
  getFleetAnalytics(@Param('fleetId') fleetId: string) {
    const analytics = this.fleetAnalytics.getFleetAnalytics(fleetId);

    if (!analytics) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }

    return analytics;
  }

  /**
   * Get playback statistics for a fleet
   */
  @Get('fleets/:fleetId/playback')
  getFleetPlayback(@Param('fleetId') fleetId: string) {
    const stats = this.fleetAnalytics.getFleetPlaybackStats(fleetId);

    if (!stats) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }

    return stats;
  }

  /**
   * Get error statistics for a fleet
   */
  @Get('fleets/:fleetId/errors')
  getFleetErrors(@Param('fleetId') fleetId: string) {
    const stats = this.fleetAnalytics.getFleetErrorStats(fleetId);

    if (!stats) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }

    return {
      totalErrors: stats.totalErrors,
      fatalErrors: stats.fatalErrors,
      byComponent: stats.byComponent,
      byType: stats.byType,
      recentErrors: stats.recentErrors.map((e) => ({
        eventId: e.eventId,
        deviceId: e.deviceId,
        timestamp: this.safeDate(e.timestampMs),
        payload: e.payload,
      })),
    };
  }

  /**
   * Get health overview for a fleet
   */
  @Get('fleets/:fleetId/health')
  getFleetHealth(@Param('fleetId') fleetId: string) {
    const overview = this.fleetAnalytics.getFleetHealthOverview(fleetId);

    if (!overview) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }

    return overview;
  }

  /**
   * Get aggregated events for all devices in a fleet
   */
  @Get('fleets/:fleetId/events')
  getFleetEvents(
    @Param('fleetId') fleetId: string,
    @Query('category') category?: 'PLAYBACK' | 'ERROR' | 'HEALTH',
    @Query('limit') limitStr?: string,
  ) {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }

    const members = Array.from(fleet.members.keys());
    const allEvents: Array<{
      eventId: string;
      deviceId: string;
      timestamp: string;
      category: string;
      payload: any;
    }> = [];

    for (const deviceId of members) {
      let deviceEvents = this.analyticsStore.getEventsForDevice(deviceId);

      if (category) {
        deviceEvents = deviceEvents.filter((e) => e.category === category);
      }

      for (const event of deviceEvents) {
        allEvents.push({
          eventId: event.eventId,
          deviceId: event.deviceId,
          timestamp: this.safeDate(event.timestampMs),
          category: event.category,
          payload: event.payload,
        });
      }
    }

    // Sort by timestamp descending
    allEvents.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const limit = parseInt(limitStr || '100', 10);
    const limitedEvents = allEvents.slice(0, limit);

    return {
      fleetId,
      totalDevices: members.length,
      totalEvents: allEvents.length,
      events: limitedEvents,
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
    const deviceIds = this.analyticsStore.getDeviceIds();
    const totalEvents = this.analyticsStore.getEventCount();

    return {
      totalDevices: deviceIds.length,
      totalEvents,
      storageLimit: 50000,
      storageUsagePercent: Math.round((totalEvents / 50000) * 100),
    };
  }

  /**
   * List all devices with analytics data
   */
  @Get('devices')
  getDevicesWithAnalytics() {
    const deviceIds = this.analyticsStore.getDeviceIds();
    const devices = deviceIds.map((id) => {
      const analytics = this.analyticsStore.getDeviceAnalytics(id);
      return {
        deviceId: id,
        lastSeen: analytics ? this.safeDate(analytics.lastSeenAt) : null,
        totalEvents: analytics?.totalEvents || 0,
        playbackCount: analytics?.playbackCount || 0,
        errorCount: analytics?.errorCount || 0,
      };
    });

    return {
      total: devices.length,
      devices: devices.sort(
        (a, b) =>
          new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime(),
      ),
    };
  }
}
