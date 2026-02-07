import type {
  AnalyticsBatch,
  AnalyticsEvent,
  PlaybackEvent,
  ErrorEvent,
  HealthEvent,
  NetworkContext,
  QueueStatus,
} from 'src/generated/analytics/v1/analytics';
import {
  EventCategory,
  ConnectionQuality,
} from 'src/generated/analytics/v1/analytics';

export class AnalyticsMapper {
  static toAnalyticsBatch(json: any): AnalyticsBatch {
    return {
      deviceId: json.device_id?.toString() ?? '',
      batchId: json.batch_id?.toString() ?? '',
      timestampMs: json.timestamp_ms ?? Date.now(),
      events: (json.events ?? []).map((e: any) => this.toAnalyticsEvent(e)),
      networkContext: json.network_context
        ? this.toNetworkContext(json.network_context)
        : undefined,
      queueStatus: json.queue_status
        ? this.toQueueStatus(json.queue_status)
        : undefined,
    };
  }

  static toAnalyticsEvent(json: any): AnalyticsEvent {
    const event: AnalyticsEvent = {
      eventId: json.event_id?.toString() ?? '',
      timestampMs: json.timestamp_ms ?? Date.now(),
      category: this.toEventCategory(json.category),
    };

    // Handle oneof payload
    if (json.playback) {
      event.playback = this.toPlaybackEvent(json.playback);
    } else if (json.error) {
      event.error = this.toErrorEvent(json.error);
    } else if (json.health) {
      event.health = this.toHealthEvent(json.health);
    }

    return event;
  }

  static toPlaybackEvent(json: any): PlaybackEvent {
    return {
      campaignId: json.campaign_id?.toString() ?? '',
      mediaId: json.media_id?.toString() ?? '',
      durationMs: json.duration_ms ?? 0,
      completed: json.completed ?? false,
    };
  }

  static toErrorEvent(json: any): ErrorEvent {
    return {
      errorType: json.error_type?.toString() ?? '',
      message: json.message?.toString() ?? '',
      stackTrace: json.stack_trace?.toString() ?? '',
      component: json.component?.toString() ?? '',
      isFatal: json.is_fatal ?? false,
    };
  }

  static toHealthEvent(json: any): HealthEvent {
    return {
      batteryLevel: json.battery_level ?? 0,
      storageFreeBytes: json.storage_free_bytes ?? 0,
      cpuUsage: json.cpu_usage ?? 0,
      memoryUsage: json.memory_usage ?? 0,
      connectionQuality: this.toConnectionQuality(json.connection_quality),
    };
  }

  static toNetworkContext(json: any): NetworkContext {
    return {
      quality: this.toConnectionQuality(json.quality),
      downloadSpeedMbps: json.download_speed_mbps ?? 0,
      latencyMs: json.latency_ms ?? 0,
    };
  }

  static toQueueStatus(json: any): QueueStatus {
    return {
      pendingCount: json.pending_count ?? 0,
      oldestEventHours: json.oldest_event_hours ?? 0,
    };
  }

  static toEventCategory(value: any): EventCategory {
    if (typeof value === 'number') {
      return value as EventCategory;
    }
    const str = value?.toString().toUpperCase() ?? '';
    switch (str) {
      case 'PLAYBACK':
      case 'EVENT_CATEGORY_PLAYBACK':
        return EventCategory.EVENT_CATEGORY_PLAYBACK;
      case 'ERROR':
      case 'EVENT_CATEGORY_ERROR':
        return EventCategory.EVENT_CATEGORY_ERROR;
      case 'HEALTH':
      case 'EVENT_CATEGORY_HEALTH':
        return EventCategory.EVENT_CATEGORY_HEALTH;
      default:
        return EventCategory.EVENT_CATEGORY_UNSPECIFIED;
    }
  }

  static toConnectionQuality(value: any): ConnectionQuality {
    if (typeof value === 'number') {
      return value as ConnectionQuality;
    }
    const str = value?.toString().toUpperCase() ?? '';
    switch (str) {
      case 'EXCELLENT':
      case 'CONNECTION_QUALITY_EXCELLENT':
        return ConnectionQuality.CONNECTION_QUALITY_EXCELLENT;
      case 'GOOD':
      case 'CONNECTION_QUALITY_GOOD':
        return ConnectionQuality.CONNECTION_QUALITY_GOOD;
      case 'FAIR':
      case 'CONNECTION_QUALITY_FAIR':
        return ConnectionQuality.CONNECTION_QUALITY_FAIR;
      case 'POOR':
      case 'CONNECTION_QUALITY_POOR':
        return ConnectionQuality.CONNECTION_QUALITY_POOR;
      case 'OFFLINE':
      case 'CONNECTION_QUALITY_OFFLINE':
        return ConnectionQuality.CONNECTION_QUALITY_OFFLINE;
      default:
        return ConnectionQuality.CONNECTION_QUALITY_UNSPECIFIED;
    }
  }
}
