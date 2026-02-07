# API Reference

Complete API documentation for the Hydrogen Node gRPC/HTTP server.

## Table of Contents

- [Overview](#overview)
- [gRPC Services](#grpc-services)
  - [ContentService](#contentservice)
  - [RemoteCommandService](#remotecommandservice)
  - [AnalyticsService](#analyticsservice)
- [HTTP REST API](#http-rest-api)
  - [Content API](#content-api)
  - [Command API](#command-api)
  - [Fleet API](#fleet-api)
  - [Analytics API](#analytics-api)
- [Common Types](#common-types)
- [Error Codes](#error-codes)

---

## Overview

The server exposes two interfaces:

| Interface | Port | Protocol | Use Case |
|-----------|------|----------|----------|
| gRPC | 50051 | HTTP/2 + Proto | Device communication (streaming) |
| HTTP REST | 31691 | HTTP/1.1 + JSON | Administrative operations |

### Base URLs

```
gRPC:  localhost:50051
HTTP:  http://localhost:31691
```

---

## gRPC Services

### ContentService

**Package:** `content.v1`

Streaming service for content delivery to devices.

#### Methods

| Method | Type | Description |
|--------|------|-------------|
| `Subscribe` | Server Streaming | Subscribe to content packages |
| `Acknowledge` | Unary | Acknowledge content receipt |

#### Subscribe

```protobuf
rpc Subscribe(SubscribeRequest) returns (stream ContentPackage);
```

**Request:**
```protobuf
message SubscribeRequest {
  string device_id = 1;
  string last_received_delivery_id = 2;  // Optional, for resume
}
```

**Response Stream:**
```protobuf
message ContentPackage {
  string delivery_id = 1;
  Content content = 2;
  repeated Media media = 3;
  bool requires_ack = 4;
  int64 timestamp_ms = 5;
}

message Content {
  string content_id = 1;
  repeated TimeSlot slots = 2;
}

message TimeSlot {
  string slot_id = 1;
  string start_time = 2;  // ISO 8601
  string end_time = 3;    // ISO 8601
  repeated Campaign campaigns = 4;
}

message Campaign {
  string campaign_id = 1;
  string name = 2;
  repeated string media_ids = 3;
  int32 priority = 4;
}

message Media {
  string media_id = 1;
  string url = 2;
  string type = 3;  // "video" or "image"
  int64 size_bytes = 4;
  string checksum = 5;
}
```

#### Acknowledge

```protobuf
rpc Acknowledge(AckRequest) returns (AckResponse);
```

**Request:**
```protobuf
message AckRequest {
  string device_id = 1;
  string delivery_id = 2;
  bool processed_successfully = 3;
  string error_message = 4;
}
```

**Response:**
```protobuf
message AckResponse {
  bool success = 1;
  string message = 2;
}
```

---

### RemoteCommandService

**Package:** `remote.v1`

Streaming service for remote device control.

#### Methods

| Method | Type | Description |
|--------|------|-------------|
| `SubscribeCommands` | Server Streaming | Subscribe to commands |
| `AcknowledgeCommand` | Unary | Acknowledge command execution |

#### SubscribeCommands

```protobuf
rpc SubscribeCommands(SubscribeRequest) returns (stream CommandPackage);
```

**Request:**
```protobuf
message SubscribeRequest {
  string device_id = 1;
}
```

**Response Stream:**
```protobuf
message CommandPackage {
  string command_id = 1;
  oneof command {
    SetClockOverride set_clock = 10;
    RequestSystemReboot request_reboot = 11;
    UpdateNetworkConfig update_network = 12;
    RotateScreen rotate_screen = 13;
  }
  bool requires_ack = 20;
  string issued_at = 21;  // ISO 8601
}

message SetClockOverride {
  string simulated_time = 1;  // ISO 8601
}

message RequestSystemReboot {
  int32 delay_seconds = 1;
}

message UpdateNetworkConfig {
  string new_ssid = 1;
  string new_password = 2;
}

message RotateScreen {
  string orientation = 1;  // "landscape", "portrait", "reverse_landscape", "reverse_portrait"
  bool fullscreen = 2;
}
```

#### AcknowledgeCommand

```protobuf
rpc AcknowledgeCommand(AckRequest) returns (AckResponse);
```

**Request:**
```protobuf
message AckRequest {
  string device_id = 1;
  string command_id = 2;
  bool processed_successfully = 3;
  string error_message = 4;
}
```

**Response:**
```protobuf
message AckResponse {
  bool success = 1;
  string message = 2;
}
```

---

### AnalyticsService

**Package:** `analytics.v1`

Event ingestion service for device telemetry.

#### Methods

| Method | Type | Description |
|--------|------|-------------|
| `Ingest` | Unary | Submit batch of analytics events (v2) |
| `Stream` | Bidirectional | Real-time event streaming (v2) |

#### Ingest (v2)

```protobuf
rpc Ingest(Batch) returns (Ack);
```

**Request:**
```protobuf
message Batch {
  bytes batch_id = 1;               // 16-byte UUID
  repeated Event events = 2;        // Multiple events
  fixed32 device_fingerprint = 3;   // 4-byte device hash
  QueueStatus queue = 4;            // Backpressure signal
  fixed64 sent_at_ms = 5;           // Batch creation time
}

message Event {
  bytes event_id = 1;           // 16-byte UUID (binary)
  fixed64 timestamp_ms = 2;     // 8 bytes fixed
  EventType type = 3;           // Enum = 1 byte varint
  fixed32 schema_version = 4;   // 0x00MMmmPP = major.minor.patch
  bytes payload = 5;            // CBOR/MsgPack/JSON encoded data
  NetworkContext network = 6;   // Optional: network at event time
}

enum EventType {
  EVENT_TYPE_UNSPECIFIED = 0;
  ERROR = 1;         // Urgent - upload on FAIR+ connections
  IMPRESSION = 2;    // Normal - upload on GOOD+ connections
  HEARTBEAT = 3;     // Background - EXCELLENT only
  PERFORMANCE = 4;   // Background - EXCELLENT only
  LIFECYCLE = 5;     // Normal - upload on GOOD+ connections
}

message NetworkContext {
  ConnectionQuality quality = 1;
  double download_mbps = 2;
  double upload_mbps = 3;
  string connection_type = 4;      // wifi, ethernet, cellular, unknown
  int32 signal_strength_dbm = 5;   // For wifi/cellular
}

enum ConnectionQuality {
  CONNECTION_QUALITY_UNSPECIFIED = 0;
  OFFLINE = 1;       // No upload
  POOR = 2;          // < 1 Mbps, errors only
  FAIR = 3;          // 1-5 Mbps, urgent only
  GOOD = 4;          // 5-20 Mbps, normal uploads
  EXCELLENT = 5;     // > 20 Mbps, all events
}

message QueueStatus {
  int32 pending_events = 1;
  int32 oldest_event_age_hours = 2;
  bool is_backpressure = 3;
}
```

**Response:**
```protobuf
message Ack {
  bytes batch_id = 1;
  bool accepted = 2;
  repeated bytes rejected_event_ids = 3;  // 16-byte UUIDs
  uint32 throttle_ms = 4;     // Server backpressure
  Policy policy = 5;          // Updated policy (optional)
}

message Policy {
  ConnectionQuality min_quality = 1;   // Minimum quality for uploads
  int32 max_batch_size = 2;            // Max events per batch
  int32 max_queue_age_hours = 3;       // Force upload if older
  int32 upload_interval_seconds = 4;   // Suggested upload interval
}
```

---

## HTTP REST API

### Content API

Base path: `/content`

#### Push Content to Device

```http
POST /content/push/:deviceId
```

Push content to a specific connected device.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceId | string | Target device ID |

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |
| ack | string | "true" | Require acknowledgment ("true" or "false") |

**Request Body:**
```json
{
  "content": {
    "content_id": "content-001",
    "slots": [
      {
        "slot_id": "slot-1",
        "start_time": "2024-01-01T00:00:00Z",
        "end_time": "2024-12-31T23:59:59Z",
        "campaigns": [
          {
            "campaign_id": "campaign-001",
            "name": "Summer Sale",
            "media_ids": ["media-001", "media-002"],
            "priority": 1
          }
        ]
      }
    ]
  },
  "media": [
    {
      "media_id": "media-001",
      "url": "https://cdn.example.com/video.mp4",
      "type": "video",
      "size_bytes": 10485760,
      "checksum": "sha256:abc123..."
    }
  ],
  "requires_ack": true
}
```

**Response:**
```json
{
  "success": true,
  "device_id": "device-001",
  "delivery_id": "delivery-123",
  "acknowledged": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Error Responses:**
| Status | Description |
|--------|-------------|
| 503 | Device not connected |
| 408 | ACK timeout |

---

#### Broadcast Content

```http
POST /content/broadcast
```

Broadcast content to all connected devices.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:** Same as `/content/push/:deviceId`

**Response:**
```json
{
  "success": true,
  "target_devices": 10,
  "successful": 8,
  "failed": 2,
  "results": [
    {
      "device_id": "device-001",
      "success": true,
      "delivery_id": "delivery-001"
    }
  ]
}
```

---

#### Get Content Stats

```http
GET /content/stats
```

Get connected device count.

**Response:**
```json
{
  "connected_devices": 5,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### Command API

Base path: `/commands`

#### List Connected Devices

```http
GET /commands/devices
```

List all devices connected to the command service.

**Response:**
```json
{
  "count": 3,
  "devices": ["device-001", "device-002", "device-003"]
}
```

---

#### Send Clock Command

```http
POST /commands/clock/:deviceId
```

Set clock override on a device.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceId | string | Target device ID |

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "simulated_time": "2024-01-01T00:00:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "device_id": "device-001",
  "command_id": "cmd-123",
  "acknowledged": true
}
```

---

#### Send Reboot Command

```http
POST /commands/reboot/:deviceId
```

Request device reboot.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceId | string | Target device ID |

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "delay_seconds": 10
}
```

**Response:** Same format as clock command.

---

#### Send Network Update Command

```http
POST /commands/network/:deviceId
```

Update device network configuration.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceId | string | Target device ID |

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "new_ssid": "NewNetwork",
  "new_password": "password123"
}
```

**Response:** Same format as clock command.

---

#### Send Rotate Screen Command

```http
POST /commands/rotate/:deviceId
```

Rotate device screen.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceId | string | Target device ID |

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "orientation": "landscape",
  "fullscreen": true
}
```

**Orientation values:** `landscape`, `portrait`, `reverse_landscape`, `reverse_portrait`

**Response:** Same format as clock command.

---

#### Broadcast Clock Command

```http
POST /commands/broadcast/clock
```

Broadcast clock command to all connected devices.

**Request Body:** Same as single-device clock command.

**Response:**
```json
{
  "success": true,
  "target_devices": 10,
  "successful": 8,
  "failed": 2,
  "ack_results": [
    {
      "device_id": "device-001",
      "command_id": "cmd-001",
      "success": true,
      "timed_out": false
    }
  ]
}
```

---

#### Broadcast Rotate Command

```http
POST /commands/broadcast/rotate
```

Broadcast rotate command to all connected devices.

**Request Body:** Same as single-device rotate command.

**Response:** Same format as broadcast clock.

---

#### Get Command Stats

```http
GET /commands/stats
```

Get connected device count.

**Response:**
```json
{
  "connected_devices": 5,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### Fleet API

Base path: `/fleets`

#### Create Fleet

```http
POST /fleets
```

Create a new fleet.

**Request Body:**
```json
{
  "name": "Store Displays",
  "description": "Digital signage in retail stores",
  "deviceIds": ["device-001", "device-002"],
  "metadata": {
    "region": "north-america",
    "store_type": "retail"
  }
}
```

**Response:**
```json
{
  "success": true,
  "fleet": {
    "id": "fleet-abc123",
    "name": "Store Displays",
    "description": "Digital signage in retail stores",
    "memberCount": 2,
    "members": [
      {
        "deviceId": "device-001",
        "joinedAt": "2024-01-01T00:00:00.000Z",
        "metadata": null
      }
    ],
    "metadata": {
      "region": "north-america"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### List All Fleets

```http
GET /fleets
```

Get all fleets.

**Response:**
```json
{
  "count": 2,
  "fleets": [
    {
      "id": "fleet-abc123",
      "name": "Store Displays",
      "memberCount": 5,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### Get Fleet

```http
GET /fleets/:fleetId
```

Get fleet details.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| fleetId | string | Fleet ID |

**Response:** Same as Create Fleet response.

**Error Responses:**
| Status | Description |
|--------|-------------|
| 404 | Fleet not found |

---

#### Update Fleet

```http
PATCH /fleets/:fleetId
```

Update fleet properties.

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "metadata": {
    "new_key": "new_value"
  }
}
```

**Response:** Same as Create Fleet response.

---

#### Delete Fleet

```http
DELETE /fleets/:fleetId
```

Delete a fleet.

**Response:**
```json
{
  "success": true,
  "message": "fleet-abc123 deleted"
}
```

---

#### Add Device to Fleet

```http
POST /fleets/:fleetId/devices/:deviceId
```

Add a device to a fleet.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| fleetId | string | Fleet ID |
| deviceId | string | Device ID |

**Request Body (optional):**
```json
{
  "metadata": {
    "location": "entrance",
    "screen_size": "55inch"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "device-001 added to fleet fleet-abc123"
}
```

---

#### Remove Device from Fleet

```http
DELETE /fleets/:fleetId/devices/:deviceId
```

Remove a device from a fleet.

**Response:**
```json
{
  "success": true,
  "message": "device-001 removed from fleet fleet-abc123"
}
```

---

#### Get Fleet Members

```http
GET /fleets/:fleetId/devices
```

Get all devices in a fleet.

**Response:**
```json
{
  "count": 2,
  "members": [
    {
      "deviceId": "device-001",
      "joinedAt": "2024-01-01T00:00:00.000Z",
      "metadata": null
    }
  ]
}
```

---

#### Get Device Memberships

```http
GET /fleets/device/:deviceId/memberships
```

Get all fleets a device belongs to.

**Response:**
```json
{
  "deviceId": "device-001",
  "fleetCount": 2,
  "fleets": [
    { "id": "fleet-abc123", "name": "Store Displays" },
    { "id": "fleet-def456", "name": "Warehouse Signs" }
  ]
}
```

---

#### Fleet Rotate Screen

```http
POST /fleets/:fleetId/commands/rotate
```

Rotate screens for all devices in a fleet.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "orientation": "landscape",
  "fullscreen": true
}
```

**Response:**
```json
{
  "success": true,
  "fleet_id": "fleet-abc123",
  "target_devices": 5,
  "successful": 4,
  "failed": 1,
  "failures": [
    {
      "deviceId": "device-003",
      "reason": "Device offline"
    }
  ],
  "ack_results": [
    {
      "device_id": "device-001",
      "command_id": "cmd-001",
      "success": true,
      "timed_out": false
    }
  ]
}
```

---

#### Fleet Reboot

```http
POST /fleets/:fleetId/commands/reboot
```

Reboot all devices in a fleet.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "delay_seconds": 10
}
```

**Response:** Same format as fleet rotate.

---

#### Fleet Network Update

```http
POST /fleets/:fleetId/commands/network
```

Update network config for all devices in a fleet.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "new_ssid": "NewNetwork",
  "new_password": "password123"
}
```

**Response:** Same format as fleet rotate.

---

#### Fleet Clock Override

```http
POST /fleets/:fleetId/commands/clock
```

Set clock override for all devices in a fleet.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |

**Request Body:**
```json
{
  "simulated_time": "2024-01-01T00:00:00Z"
}
```

**Response:** Same format as fleet rotate.

---

#### Fleet Content Push

```http
POST /fleets/:fleetId/content/push
```

Push content to all devices in a fleet.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| timeout | number | 5000 | ACK timeout in milliseconds |
| ack | string | "true" | Require acknowledgment |

**Request Body:** Same as `/content/push/:deviceId`

**Response:**
```json
{
  "success": true,
  "fleet_id": "fleet-abc123",
  "target_devices": 5,
  "successful": 4,
  "failed": 1,
  "failures": [
    {
      "deviceId": "device-003",
      "reason": "Device offline"
    }
  ]
}
```

---

### Analytics API

Base path: `/analytics`

#### Get Global Summary

```http
GET /analytics/summary
```

Get global analytics summary.

**Response:**
```json
{
  "totalDevices": 10,
  "totalEvents": 1250,
  "storageLimit": 50000,
  "storageUsagePercent": 2
}
```

---

#### List Devices with Analytics

```http
GET /analytics/devices
```

List all devices that have analytics data.

**Response:**
```json
{
  "total": 3,
  "devices": [
    {
      "deviceFingerprint": 305419896,
      "lastSeen": "2024-01-01T12:00:00.000Z",
      "totalEvents": 150,
      "eventsByType": {
        "ERROR": 5,
        "IMPRESSION": 100,
        "HEARTBEAT": 30,
        "PERFORMANCE": 10,
        "LIFECYCLE": 5,
        "UNKNOWN": 0
      }
    }
  ]
}
```

---

#### Ingest Events (v2)

```http
POST /analytics/ingest/:deviceFingerprint
```

Submit analytics events. Payload is JSON and will be encoded to CBOR by the server.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceFingerprint | number | 4-byte device fingerprint |

**Request Body:**
```json
{
  "events": [
    {
      "event_id": "550e8400e29b41d4a716446655440000",
      "timestamp_ms": 1704121200000,
      "type": "IMPRESSION",
      "schema_version": 65536,
      "payload": {"c": "campaign-001", "p": 1, "t": 1704121200000, "d": 5000, "v": 1},
      "network": {
        "quality": "GOOD",
        "download_mbps": 10.5,
        "upload_mbps": 5.0,
        "connection_type": "wifi",
        "signal_strength_dbm": -50
      }
    }
  ],
  "queue": {
    "pending_events": 5,
    "oldest_event_age_hours": 1,
    "is_backpressure": false
  }
}
```

**Response:**
```json
{
  "accepted": true,
  "batch_id": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "events_received": 1,
  "events_stored": 1,
  "rejected_event_ids": [],
  "policy": {
    "min_quality": 3,
    "max_batch_size": 100,
    "max_queue_age_hours": 24,
    "upload_interval_seconds": 300
  }
}
```

---

#### Get Device Events

```http
GET /analytics/devices/:deviceFingerprint/events
```

Get analytics events for a device.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| deviceFingerprint | number | Device fingerprint |

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| type | number | Filter by event type: `1=ERROR`, `2=IMPRESSION`, `3=HEARTBEAT`, `4=PERFORMANCE`, `5=LIFECYCLE` |
| limit | number | Maximum events to return (default: 100) |

**Response:**
```json
{
  "deviceFingerprint": 305419896,
  "totalEvents": 50,
  "events": [
    {
      "eventId": "aaaaaaaaaaaaaaaaaaaaaaaa",
      "batchId": "bbbbbbbbbbbbbbbbbbbbbbbb",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "type": "IMPRESSION",
      "schemaVersion": "1.0.0",
      "payload": {"c": "campaign-001", "p": 1, "t": 1704121200000, "d": 5000, "v": 1}
    }
  ]
}
```

---

#### Get Device Summary

```http
GET /analytics/devices/:deviceFingerprint/summary
```

Get analytics summary for a device.

**Response:**
```json
{
  "deviceFingerprint": 305419896,
  "lastSeen": "2024-01-01T12:00:00.000Z",
  "totalEvents": 150,
  "eventsByType": {
    "ERROR": 5,
    "IMPRESSION": 100,
    "HEARTBEAT": 30,
    "PERFORMANCE": 10,
    "LIFECYCLE": 5,
    "UNKNOWN": 0
  },
  "lastNetworkQuality": "GOOD"
}
```

**Error Responses:**
| Status | Description |
|--------|-------------|
| 404 | No analytics data found for device |

---

#### Get Server Policy

```http
GET /analytics/policy
```

Get the current server upload policy.

**Response:**
```json
{
  "min_quality": 3,
  "max_batch_size": 100,
  "max_queue_age_hours": 24,
  "upload_interval_seconds": 300
}
```

## Common Types

### ConnectionQuality Enum

| Value | Description | Speed |
|-------|-------------|-------|
| 0 | `UNSPECIFIED` | Unknown |
| 1 | `EXCELLENT` | > 10 Mbps |
| 2 | `GOOD` | > 5 Mbps |
| 3 | `FAIR` | > 1 Mbps |
| 4 | `POOR` | < 1 Mbps |
| 5 | `OFFLINE` | No connection |

### EventType Enum

| Value | Name | Description | Upload Priority |
|-------|------|-------------|-----------------|
| 0 | `UNSPECIFIED` | Unknown type | - |
| 1 | `ERROR` | Application errors | Urgent (FAIR+) |
| 2 | `IMPRESSION` | Media impression events | Normal (GOOD+) |
| 3 | `HEARTBEAT` | Device heartbeat | Background (EXCELLENT) |
| 4 | `PERFORMANCE` | Performance metrics | Background (EXCELLENT) |
| 5 | `LIFECYCLE` | App lifecycle events | Normal (GOOD+) |

---

## Error Codes

### HTTP Status Codes

| Status | Code | Description |
|--------|------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 207 | Multi-Status | Partial success (fleet operations) |
| 400 | Bad Request | Invalid request body |
| 404 | Not Found | Resource not found |
| 408 | Request Timeout | ACK timeout from device |
| 502 | Bad Gateway | Device command/content failed |
| 503 | Service Unavailable | Device not connected |

### gRPC Status Codes

| Code | Description |
|------|-------------|
| OK | Request successful |
| UNKNOWN | Internal server error |
| INVALID_ARGUMENT | Invalid request parameters |
| NOT_FOUND | Resource not found |
| UNAVAILABLE | Device not connected |
| DEADLINE_EXCEEDED | Timeout waiting for ACK |

---

## Example Usage

### gRPC with grpcurl

```bash
# List available services
grpcurl -plaintext localhost:50051 list

# List methods in AnalyticsService
grpcurl -plaintext localhost:50051 list analytics.v1.AnalyticsService

# Ingest analytics batch (v2) - uses binary UUIDs and CBOR payload
# Note: grpcurl requires base64 encoding for bytes fields
echo '{
  "batch_id": "AAAAAAAAAAAAAAAAAAAAAQ==",
  "device_fingerprint": 305419896,
  "sent_at_ms": "1704121200000",
  "events": [
    {
      "event_id": "AAAAAAAAAAAAAAAAAAAAAg==",
      "timestamp_ms": "1704121200000",
      "type": "IMPRESSION",
      "schema_version": 65536,
      "payload": "omNpZGNhbXBhaWduLTAwMXBpAXRqMTcwNDEyMTIwMDAwMGRqNTAwMHZoAQ==",
      "network": {
        "quality": "GOOD",
        "download_mbps": 10.5,
        "upload_mbps": 5.0,
        "connection_type": "wifi"
      }
    }
  ]
}' | grpcurl -plaintext -d @ localhost:50051 analytics.v1.AnalyticsService/Ingest
```

### HTTP with curl

```bash
# Get analytics summary
curl http://localhost:31691/analytics/summary

# Get device events (v2 uses device fingerprint)
curl http://localhost:31691/analytics/devices/305419896/events

# Ingest events (v2) - payload is JSON, encoded to CBOR by server
curl -X POST http://localhost:31691/analytics/ingest/305419896 \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "event_id": "550e8400e29b41d4a716446655440000",
        "timestamp_ms": 1704121200000,
        "type": "IMPRESSION",
        "schema_version": 65536,
        "payload": {"c": "campaign-001", "p": 1, "t": 1704121200000, "d": 5000, "v": 1},
        "network": {
          "quality": "GOOD",
          "download_mbps": 10.5,
          "upload_mbps": 5.0,
          "connection_type": "wifi"
        }
      }
    ]
  }'

# Create a fleet
curl -X POST http://localhost:31691/fleets \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Fleet", "deviceIds": ["device-001"]}'

# Send command to device
curl -X POST http://localhost:31691/commands/rotate/device-001 \
  -H "Content-Type: application/json" \
  -d '{"orientation": "landscape", "fullscreen": true}'
```

---

*Generated: 2026-02-07*
