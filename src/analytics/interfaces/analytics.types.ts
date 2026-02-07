// StoredAnalyticsEvent represents a stored analytics event on the server
export interface StoredAnalyticsEvent {
  eventId: string;
  deviceId: string;
  batchId: string;
  timestampMs: number;
  category: 'PLAYBACK' | 'ERROR' | 'HEALTH';
  payload: PlaybackRecord | ErrorRecord | HealthRecord;
  uploadedAt: number;
}

export interface PlaybackRecord {
  campaignId: string;
  mediaId: string;
  durationMs: number;
  completed: boolean;
}

export interface ErrorRecord {
  errorType: string;
  message: string;
  stackTrace?: string;
  component: string;
  isFatal: boolean;
}

export interface HealthRecord {
  batteryLevel?: number;
  storageFreeBytes?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  connectionQuality?: string;
}

// DeviceAnalytics aggregates events per device
export interface DeviceAnalytics {
  deviceId: string;
  lastSeenAt: number;
  totalEvents: number;
  playbackCount: number;
  errorCount: number;
  lastHealthSnapshot?: HealthRecord;
}

// FleetAnalytics aggregates events per fleet
export interface FleetAnalytics {
  fleetId: string;
  totalDevices: number;
  totalEvents: number;
  playbackStats: {
    totalPlays: number;
    uniqueCampaigns: number;
    averageDurationMs: number;
  };
  errorStats: {
    totalErrors: number;
    fatalErrors: number;
    topComponents: Array<{ component: string; count: number }>;
  };
  healthOverview: {
    healthyDevices: number;
    warningDevices: number;
    criticalDevices: number;
  };
}

// UploadPolicy configuration
export interface SyncPolicy {
  maxBatchSize: number;
  syncIntervalSeconds: number;
  retryDelaysSeconds: number[];
}
