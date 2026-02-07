// Analytics v2 Types - Minimal envelope + CBOR payload

import type { EventType, ConnectionQuality } from '../../generated/analytics/v1/analytics';

export type { EventType, ConnectionQuality };

/** Stored analytics event after decoding CBOR payload */
export interface StoredAnalyticsEvent {
  eventId: string;          // Hex string of 16-byte UUID
  deviceFingerprint: number; // 4-byte device hash
  batchId: string;          // Hex string of 16-byte UUID
  timestampMs: number;
  type: EventType;
  schemaVersion: number;    // 0x00MMmmPP format
  payload: unknown;         // Decoded CBOR payload
  network?: NetworkContext;
  receivedAt: number;
}

/** Event type as string for display */
export type EventTypeString = 'ERROR' | 'IMPRESSION' | 'HEARTBEAT' | 'PERFORMANCE' | 'LIFECYCLE' | 'UNKNOWN';

/** Network context at event time */
export interface NetworkContext {
  quality: ConnectionQuality;
  downloadMbps?: number;
  uploadMbps?: number;
  connectionType?: string;
  signalStrengthDbm?: number;
}

/** Device analytics summary */
export interface DeviceAnalytics {
  deviceFingerprint: number;
  lastSeenAt: number;
  totalEvents: number;
  eventsByType: Record<EventTypeString, number>;
  lastNetworkQuality?: ConnectionQuality;
}

/** Fleet analytics summary */
export interface FleetAnalytics {
  fleetId: string;
  totalDevices: number;
  totalEvents: number;
  eventsByType: Record<EventTypeString, number>;
  recentEvents: StoredAnalyticsEvent[];
}

/** Upload policy from server - using local enum for values */
export interface Policy {
  minQuality: ConnectionQuality;
  maxBatchSize: number;
  maxQueueAgeHours: number;
  uploadIntervalSeconds: number;
}

/** Queue status from client */
export interface QueueStatus {
  pendingEvents: number;
  oldestEventAgeHours: number;
  isBackpressure: boolean;
}

/** CBOR payload schema versions */
export interface ImpressionPayloadV1 {
  c: string;      // campaignId
  p: number;      // playCount
  t: number;      // lastPlayedAt timestamp ms
  d: number;      // totalPlayTime ms
  m?: string;     // lastMediaId (optional)
  v: number;      // schema version
}

export interface ErrorPayloadV1 {
  code: string;       // error code
  msg: string;        // message
  component?: string; // source component
  fatal?: boolean;    // is fatal
  v: number;          // schema version
}

export interface HeartbeatPayloadV1 {
  uptime: number;     // device uptime ms
  battery?: number;   // battery level 0-100
  v: number;          // schema version
}

export interface PerformancePayloadV1 {
  cpu: number;        // CPU usage 0-100
  memory: number;     // Memory usage 0-100
  fps?: number;       // frame rate
  v: number;          // schema version
}

export interface LifecyclePayloadV1 {
  action: string;     // e.g., "app_start", "app_resume"
  prevState?: string; // previous state
  v: number;          // schema version
}
