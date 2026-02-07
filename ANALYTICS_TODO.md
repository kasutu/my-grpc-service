# Analytics Module Implementation Plan

> **Communication Log:**  
> - **mike:** Created this plan based on ARCHITECTURE.md review
> - **mike:** Implemented all phases including fixture and tests
> - **jay:** (pending review)

---

## Overview

This document tracks the implementation of the **Analytics Module** for the Hydrogen Node gRPC server. The module handles:
- Playback impression tracking
- Error event collection
- Device health metrics
- Network-quality-aware batch syncing

Reference: `/home/kasutu/Documents/dev/hydrogen-node/docs/ARCHITECTURE.md` (Lines 686-1035)

---

## Implementation Checklist

### Phase 1: Protocol Buffer Schema ✅ COMPLETE

- [x] **1.1 Create analytics proto file** (`src/analytics/v1/analytics.proto`)
  - [x] Define `AnalyticsService` with `UploadBatch` RPC
  - [x] Define `AnalyticsBatch` message
  - [x] Define `AnalyticsEvent` message with `oneof payload`
  - [x] Define `PlaybackEvent`, `ErrorEvent`, `HealthEvent` messages
  - [x] Define `BatchAck`, `QueueStatus`, `NetworkContext` messages
  - [x] Define `ConnectionQuality` enum
  - [x] Define `EventCategory` enum

- [x] **1.2 Generate TypeScript types**
  - [x] Run `./proto.sh` to generate `src/generated/analytics/v1/analytics.ts`
  - [x] Verify generated types compile without errors

- [x] **1.3 Update gRPC client options** (`src/grpc-client.options.ts`)
  - [x] Add `analytics.v1` to packages array
  - [x] Add path to `analytics.proto` in protoPath array

---

### Phase 2: Core Analytics Module Structure ✅ COMPLETE

- [x] **2.1 Create AnalyticsModule** (`src/analytics/analytics.module.ts`)
  - [x] Define module with providers and controllers
  - [x] Export AnalyticsService for other modules

- [x] **2.2 Create AnalyticsController** (`src/analytics/analytics.controller.ts`)
  - [x] Implement `UploadBatch` gRPC method
  - [x] Handle batch validation
  - [x] Return `BatchAck` response

- [x] **2.3 Create AnalyticsService** (`src/analytics/analytics.service.ts`)
  - [x] Process incoming analytics batches
  - [x] Store events (in-memory for MVP)
  - [x] Handle batch acknowledgment logic

- [x] **2.4 Update AppModule** (`src/app.module.ts`)
  - [x] Import `AnalyticsModule`

---

### Phase 3: Data Models & Storage ✅ COMPLETE

- [x] **3.1 Define Analytics Types** (`src/analytics/interfaces/analytics.types.ts`)
  - [x] `StoredAnalyticsEvent` interface
  - [x] `PlaybackRecord` interface
  - [x] `ErrorRecord` interface
  - [x] `DeviceHealthSnapshot` interface
  - [x] `UploadPolicy` interface

- [x] **3.2 Create AnalyticsStore** (`src/analytics/services/analytics-store.service.ts`)
  - [x] In-memory storage for analytics data
  - [x] Methods: `storeEvents()`, `getEvents()`, `cleanupOldEvents()`
  - [x] Support filtering by device, time range, event type
  - [x] `clear()` method for testing

---

### Phase 4: HTTP API (Fleet-Level Analytics) ✅ COMPLETE

- [x] **4.1 Create AnalyticsHttpController** (`src/analytics/analytics-http.controller.ts`)
  - [x] `GET /analytics/devices/:deviceId/events` - Get events for a device
  - [x] `GET /analytics/devices/:deviceId/summary` - Get device summary
  - [x] `GET /analytics/devices/:deviceId/queue` - Get queue status
  - [x] `GET /analytics/fleets/:fleetId` - Get full fleet analytics
  - [x] `GET /analytics/fleets/:fleetId/playback` - Playback statistics
  - [x] `GET /analytics/fleets/:fleetId/errors` - Error summaries
  - [x] `GET /analytics/fleets/:fleetId/health` - Device health overview
  - [x] `GET /analytics/fleets/:fleetId/events` - Fleet events
  - [x] `GET /analytics/summary` - Global summary
  - [x] `GET /analytics/devices` - List devices with analytics

- [x] **4.2 Create Fleet Analytics Service** (`src/analytics/services/fleet-analytics.service.ts`)
  - [x] Aggregate events by fleet
  - [x] Calculate playback statistics (total plays, unique campaigns)
  - [x] Error rate calculations
  - [x] Health status summaries

---

### Phase 5: Integration & Testing ✅ COMPLETE

- [x] **5.1 Create Test Fixture** (`test/fixtures/analytics.fixture.ts`)
  - [x] `AnalyticsFixture` class with factory methods
  - [x] `AnalyticsFixtures` with predefined test data
  - [x] Support for playback, error, and health events
  - [x] Valid and invalid batch generators

- [x] **5.2 E2E Tests** (`test/e2e.ts`)
  - [x] Test `UploadBatch` gRPC endpoint - valid batch
  - [x] Test batch rejection - missing device_id
  - [x] Test batch rejection - empty events
  - [x] Test batch rejection - oversized batch
  - [x] Test HTTP GET /analytics/devices
  - [x] Test HTTP GET /analytics/devices/:id/events
  - [x] Test HTTP GET /analytics/devices/:id/summary
  - [x] Test HTTP GET /analytics/devices/:id/summary - 404
  - [x] Test HTTP GET /analytics/fleets/:id
  - [x] Test HTTP GET /analytics/fleets/:id - 404
  - [x] Test HTTP GET /analytics/fleets/:id/playback
  - [x] Test HTTP GET /analytics/fleets/:id/errors
  - [x] Test HTTP GET /analytics/summary

- [x] **5.3 Manual Testing Verified**
  - [x] Server starts with AnalyticsModule
  - [x] gRPC reflection shows AnalyticsService
  - [x] All HTTP endpoints respond correctly

**Test Results:** `18 passed, 0 failed` ✅

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | In-memory (MVP) | Simple, no DB dependency |
| Event retention | 7 days | Matches client-side TTL |
| Max batch size | 100 events | Matches client default |
| Sync policy | Server returns policy | Allows server-side control |

---

## Proto Schema

```protobuf
// src/analytics/v1/analytics.proto
syntax = "proto3";

package analytics.v1;

service AnalyticsService {
  rpc UploadBatch(AnalyticsBatch) returns (BatchAck);
}

message AnalyticsBatch {
  string device_id = 1;
  string batch_id = 2;
  int64 timestamp_ms = 3;
  repeated AnalyticsEvent events = 4;
  NetworkContext network_context = 5;
  QueueStatus queue_status = 6;
}

message AnalyticsEvent {
  string event_id = 1;
  int64 timestamp_ms = 2;
  EventCategory category = 3;
  oneof payload {
    PlaybackEvent playback = 10;
    ErrorEvent error = 11;
    HealthEvent health = 12;
  }
}

enum EventCategory {
  EVENT_CATEGORY_UNSPECIFIED = 0;
  EVENT_CATEGORY_PLAYBACK = 1;
  EVENT_CATEGORY_ERROR = 2;
  EVENT_CATEGORY_HEALTH = 3;
}

message PlaybackEvent {
  string campaign_id = 1;
  string media_id = 2;
  int64 duration_ms = 3;
  bool completed = 4;
}

message ErrorEvent {
  string error_type = 1;
  string message = 2;
  string stack_trace = 3;
  string component = 4;
  bool is_fatal = 5;
}

message HealthEvent {
  float battery_level = 1;
  int64 storage_free_bytes = 2;
  float cpu_usage = 3;
  float memory_usage = 4;
  ConnectionQuality connection_quality = 5;
}

message NetworkContext {
  ConnectionQuality quality = 1;
  float download_speed_mbps = 2;
  int64 latency_ms = 3;
}

enum ConnectionQuality {
  CONNECTION_QUALITY_UNSPECIFIED = 0;
  CONNECTION_QUALITY_EXCELLENT = 1;
  CONNECTION_QUALITY_GOOD = 2;
  CONNECTION_QUALITY_FAIR = 3;
  CONNECTION_QUALITY_POOR = 4;
  CONNECTION_QUALITY_OFFLINE = 5;
}

message QueueStatus {
  int32 pending_count = 1;
  int32 oldest_event_hours = 2;
}

message BatchAck {
  bool accepted = 1;
  string batch_id = 2;
  repeated string failed_event_ids = 3;
  string rejection_reason = 4;
  UploadPolicy policy = 5;
}

message UploadPolicy {
  int32 max_batch_size = 1;
  int32 sync_interval_seconds = 2;
  repeated int32 retry_delays_seconds = 3;
}
```

---

## File Structure

```
src/
├── analytics/
│   ├── v1/
│   │   └── analytics.proto              # Protocol buffer schema
│   ├── interfaces/
│   │   └── analytics.types.ts           # TypeScript interfaces
│   ├── services/
│   │   ├── analytics-store.service.ts   # In-memory storage
│   │   └── fleet-analytics.service.ts   # Fleet aggregation
│   ├── analytics.module.ts              # NestJS module
│   ├── analytics.controller.ts          # gRPC controller
│   ├── analytics-http.controller.ts     # HTTP REST controller
│   └── analytics.service.ts             # Business logic
├── generated/analytics/v1/
│   └── analytics.ts                     # Generated TypeScript
test/
├── fixtures/
│   └── analytics.fixture.ts             # Test fixtures
└── e2e.ts                               # E2E tests (updated)
```

---

## API Reference

### gRPC

| Method | Request | Response |
|--------|---------|----------|
| `AnalyticsService.UploadBatch` | `AnalyticsBatch` | `BatchAck` |

### HTTP REST

| Endpoint | Description |
|----------|-------------|
| `GET /analytics/devices` | List all devices with analytics |
| `GET /analytics/devices/:deviceId/events?category=&limit=` | Get device events |
| `GET /analytics/devices/:deviceId/summary` | Get device summary |
| `GET /analytics/devices/:deviceId/queue` | Get queue status |
| `GET /analytics/fleets/:fleetId` | Full fleet analytics |
| `GET /analytics/fleets/:fleetId/playback` | Playback statistics |
| `GET /analytics/fleets/:fleetId/errors` | Error summaries |
| `GET /analytics/fleets/:fleetId/health` | Health overview |
| `GET /analytics/fleets/:fleetId/events?category=` | Fleet events |
| `GET /analytics/summary` | Global summary |

---

## Testing

### Run E2E Tests
```bash
npm test
```

### Run Unit Tests
```bash
npm run test:unit
```

### Test Coverage
- gRPC UploadBatch (valid/invalid batches)
- HTTP Device endpoints
- HTTP Fleet endpoints
- Error handling
- Edge cases (empty batches, oversized batches)

---

## Summary

**mike (2026-02-07):**
- ✅ Completed Phase 1: Protocol Buffer Schema
- ✅ Completed Phase 2: Core Module Structure
- ✅ Completed Phase 3: Data Models & Storage
- ✅ Completed Phase 4: HTTP API (Fleet-Level Analytics)
- ✅ Completed Phase 5: Integration & Testing
  - Created comprehensive test fixture
  - Added 13 new E2E tests (all passing)
  - 18 total tests passing

The Analytics Module is fully implemented and tested!

**jay (watcher, 2026-02-07):**
- ✅ Verified all 10 integration tests in `test/integration/analytics.test.ts` passing
- ✅ Server starts successfully with `bun run start:prod`
- ✅ Fixed package.json `start:prod` script (was `node`, now `bun`)
- ✅ Fixed AnalyticsService method naming (`uploadBatch` public, `processBatch` private)
- ✅ Updated AGENTS.md with complete Analytics API examples
- ✅ Manual curl tests verified all HTTP endpoints working

---

*Last updated: 2026-02-07 by mike & jay*
