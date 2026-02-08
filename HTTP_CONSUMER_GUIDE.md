# HTTP Consumer Integration Guide

This guide is for developers integrating with the Hydrogen Node Management Server via its HTTP REST API. It covers all available endpoints, request/response formats, error handling, and best practices.

## Table of Contents

- [Overview](#overview)
- [Base URL & Configuration](#base-url--configuration)
- [Common Patterns](#common-patterns)
- [Content API](#content-api)
- [Commands API](#commands-api)
- [Fleet API](#fleet-api)
- [Analytics API](#analytics-api)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## Overview

The HTTP REST API provides administrative access to manage a fleet of IoT/display devices (hydrogen nodes). It complements the gRPC streaming interface that devices use for real-time communication.

**Key capabilities:**
- Push content to individual devices or broadcast to all
- Send remote commands (reboot, network config, screen rotation, clock override)
- Organize devices into fleets for bulk operations
- Collect and query analytics events from devices

**Important notes:**
- All data is stored in-memory (lost on server restart)
- No authentication layer (assumes private network deployment)
- Request/response bodies use `snake_case` field names

---

## Base URL & Configuration

```
Base URL: http://localhost:31691
```

| Setting | Value | Description |
|---------|-------|-------------|
| Protocol | HTTP/1.1 | Standard REST API |
| Port | `31691` | Configurable via environment |
| Content-Type | `application/json` | All requests/responses |
| Encoding | UTF-8 | Character encoding |

### Query Parameters (Common)

Most command and content endpoints support these optional query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `timeout` | `5000` | ACK timeout in milliseconds (5000 = 5 seconds) |
| `ack` | `true` | Whether to wait for device acknowledgment (`true`/`false`) |

---

## Common Patterns

### Acknowledgment-Based Operations

Operations that send data to devices (content push, commands) follow an acknowledgment pattern:

1. **HTTP request** is sent to the server
2. **Server delivers** the package/command to the device via gRPC
3. **Device processes** and sends acknowledgment(s) back
4. **Server responds** to HTTP request with final result

**Acknowledgment Status Flow:**

```
Content:  RECEIVED → IN_PROGRESS → COMPLETED/PARTIAL/FAILED
Command:  RECEIVED → COMPLETED/FAILED/REJECTED
```

The HTTP response waits only for **final** statuses (COMPLETED, PARTIAL, FAILED, REJECTED).

### Response Format

Successful operations return a consistent envelope:

```json
{
  "success": true,
  "delivery_id": "pkg-123",
  "device_id": "device-001",
  "message": "Content delivered successfully",
  "timed_out": false
}
```

Broadcast operations return aggregate results:

```json
{
  "success": false,
  "total_devices": 3,
  "successful": 2,
  "failed": 1,
  "timed_out": 0,
  "results": [
    { "device_id": "device-001", "success": true, ... },
    { "device_id": "device-002", "success": false, "error": "not connected", ... }
  ]
}
```

---

## Content API

Push media content (campaigns with time slots) to connected devices.

### Push Content to Device

```http
POST /content/push/:deviceId
```

Push a content package to a specific device with optional acknowledgment.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `deviceId` | string | Target device identifier |

**Query Parameters:**
| Name | Default | Description |
|------|---------|-------------|
| `timeout` | `5000` | ACK timeout in milliseconds |
| `ack` | `true` | Require device acknowledgment |

**Request Body:**

```json
{
  "delivery_id": "campaign-summer-2024",
  "requires_ack": true,
  "content": {
    "id": 1,
    "hmac_signature": "sha256=abc123...",
    "created_at": "2024-01-15T10:30:00Z",
    "fallback_media_ref": { "media_id": "fallback-001" },
    "time_slots": [
      {
        "id": "slot-morning",
        "start_window": "06:00",
        "end_window": "12:00",
        "campaigns": [
          {
            "id": "camp-coffee",
            "index": 0,
            "media_id": "media-coffee-ad"
          }
        ]
      }
    ]
  },
  "media": [
    {
      "id": "media-coffee-ad",
      "checksum": "md5:d41d8cd98f00b204e9800998ecf8427e",
      "url": "https://cdn.example.com/ads/coffee.mp4"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "delivery_id": "campaign-summer-2024",
  "device_id": "device-001",
  "message": "Content delivered successfully",
  "timed_out": false
}
```

**Response (503 Service Unavailable):** Device not connected

```json
{
  "success": false,
  "delivery_id": "campaign-summer-2024",
  "device_id": "device-001",
  "message": "Device device-001 not connected",
  "timed_out": false
}
```

**Response (408 Request Timeout):** ACK not received in time

```json
{
  "success": false,
  "delivery_id": "campaign-summer-2024",
  "device_id": "device-001",
  "message": "Acknowledgment timeout",
  "timed_out": true
}
```

---

### Broadcast Content to All Devices

```http
POST /content/broadcast
```

Push the same content package to all currently connected devices.

**Query Parameters:** Same as `/content/push/:deviceId`

**Request Body:** Same as `/content/push/:deviceId`

**Response (200 OK):**

```json
{
  "success": true,
  "total_devices": 5,
  "successful": 5,
  "failed": 0,
  "timed_out": 0,
  "results": [
    { "device_id": "device-001", "success": true, ... },
    { "device_id": "device-002", "success": true, ... }
  ]
}
```

**Response (502 Bad Gateway):** All devices failed

```json
{
  "success": false,
  "total_devices": 3,
  "successful": 0,
  "failed": 3,
  "timed_out": 0,
  "results": [...]
}
```

---

### Get Content Stats

```http
GET /content/stats
```

Get the count of devices currently connected for content delivery.

**Response:**

```json
{
  "connected_devices": 5
}
```

---

## Commands API

Send remote commands to control device behavior.

### List Connected Devices

```http
GET /commands/devices
```

Get detailed information about all devices connected to the command stream.

**Response:**

```json
{
  "count": 2,
  "devices": [
    {
      "device_id": "device-001",
      "connected_at": "2024-01-15T10:30:00.000Z",
      "last_activity": "2024-01-15T10:35:00.000Z",
      "connected_for_seconds": 300
    }
  ]
}
```

---

### Set Clock Override

```http
POST /commands/clock/:deviceId
```

Override the device's system clock (useful for testing time-based content).

**Request Body:**

```json
{
  "simulated_time": "2024-12-25T00:00:00Z"
}
```

**Response:** Same format as content push response

---

### Request System Reboot

```http
POST /commands/reboot/:deviceId
```

Request the device to reboot.

**Request Body:**

```json
{
  "delay_seconds": 10
}
```

| Field | Type | Description |
|-------|------|-------------|
| `delay_seconds` | number | Seconds to wait before rebooting (0 = immediate) |

---

### Update Network Configuration

```http
POST /commands/network/:deviceId
```

Change the device's WiFi network settings.

**Request Body:**

```json
{
  "new_ssid": "MyNewNetwork",
  "new_password": "securepassword123"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `new_ssid` | string | New WiFi network name |
| `new_password` | string | New WiFi password |

---

### Rotate Screen

```http
POST /commands/rotate/:deviceId
```

Change the device's screen orientation.

**Request Body:**

```json
{
  "orientation": "landscape",
  "fullscreen": true
}
```

| Field | Type | Options | Description |
|-------|------|---------|-------------|
| `orientation` | string | `auto`, `portrait`, `landscape` | Screen orientation |
| `fullscreen` | boolean | `true`, `false` | Enable fullscreen mode |

---

### Broadcast Commands

```http
POST /commands/broadcast/clock
POST /commands/broadcast/rotate
```

Send clock override or screen rotation commands to all connected devices.

**Request Body:** Same as individual device commands

**Response:** Same format as content broadcast response

---

### Get Command Stats

```http
GET /commands/stats
```

Get the count of devices connected to the command stream.

**Response:**

```json
{
  "connected_devices": 5
}
```

---

## Fleet API

Organize devices into logical groups for bulk operations.

### Create Fleet

```http
POST /fleets
```

Create a new fleet of devices.

**Request Body:**

```json
{
  "id": "fleet-nyc-stores",
  "name": "NYC Store Displays",
  "description": "All displays in NYC retail locations",
  "metadata": {
    "region": "northeast",
    "timezone": "America/New_York"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique fleet identifier |
| `name` | string | Yes | Human-readable name |
| `description` | string | No | Fleet description |
| `metadata` | object | No | Custom key-value pairs |

**Response (201 Created):**

```json
{
  "success": true,
  "fleet": {
    "id": "fleet-nyc-stores",
    "name": "NYC Store Displays",
    "description": "All displays in NYC retail locations",
    "memberCount": 0,
    "members": [],
    "metadata": { "region": "northeast", ... },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### List All Fleets

```http
GET /fleets
```

Get all fleets with their member counts.

**Response:**

```json
{
  "count": 2,
  "fleets": [
    {
      "id": "fleet-nyc-stores",
      "name": "NYC Store Displays",
      "description": "...",
      "memberCount": 5,
      "members": [...],
      "metadata": {...},
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### Get Fleet Details

```http
GET /fleets/:fleetId
```

Get detailed information about a specific fleet.

**Response (200 OK):** Fleet object (see Create Fleet response)

**Response (404 Not Found):** Fleet doesn't exist

---

### Update Fleet

```http
PATCH /fleets/:fleetId
```

Update fleet metadata (name, description, or custom metadata).

**Request Body:** (all fields optional)

```json
{
  "name": "Updated Name",
  "description": "New description",
  "metadata": { "updated": true }
}
```

---

### Delete Fleet

```http
DELETE /fleets/:fleetId
```

Delete a fleet and remove all device memberships.

**Response:**

```json
{
  "success": true,
  "message": "Fleet fleet-nyc-stores deleted"
}
```

---

### Add Device to Fleet

```http
POST /fleets/:fleetId/devices/:deviceId
```

Add a device to a fleet.

**Request Body:** (optional)

```json
{
  "metadata": {
    "store_id": "store-123",
    "position": "entrance"
  }
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "message": "Device device-001 added to fleet fleet-nyc-stores"
}
```

---

### Remove Device from Fleet

```http
DELETE /fleets/:fleetId/devices/:deviceId
```

Remove a device from a fleet.

**Response:**

```json
{
  "success": true,
  "message": "Device device-001 removed from fleet fleet-nyc-stores"
}
```

---

### List Fleet Members

```http
GET /fleets/:fleetId/devices
```

Get all devices in a fleet.

**Response:**

```json
{
  "count": 3,
  "members": [
    {
      "deviceId": "device-001",
      "joinedAt": "2024-01-15T10:30:00.000Z",
      "metadata": { "store_id": "store-123" }
    }
  ]
}
```

---

### Get Device Memberships

```http
GET /fleets/device/:deviceId/memberships
```

Get all fleets that a device belongs to.

**Response:**

```json
{
  "deviceId": "device-001",
  "fleetCount": 2,
  "fleets": [
    { "id": "fleet-nyc-stores", "name": "NYC Store Displays" },
    { "id": "fleet-promo", "name": "Promotional Displays" }
  ]
}
```

---

### Fleet Commands

Send commands to all devices in a fleet:

```http
POST /fleets/:fleetId/commands/rotate
POST /fleets/:fleetId/commands/reboot
POST /fleets/:fleetId/commands/network
POST /fleets/:fleetId/commands/clock
```

**Query Parameters:**
| Name | Default | Description |
|------|---------|-------------|
| `timeout` | `5000` | ACK timeout in milliseconds |

**Request Body:** Same as individual device commands

**Response (200 OK):** All devices succeeded

```json
{
  "success": true,
  "fleet_id": "fleet-nyc-stores",
  "target_devices": 5,
  "successful": 5,
  "failed": 0,
  "failures": [],
  "ack_results": [...]
}
```

**Response (207 Partial Content):** Some devices succeeded

**Response (502 Bad Gateway):** All devices failed

---

### Push Content to Fleet

```http
POST /fleets/:fleetId/content/push
```

Push content to all devices in a fleet.

**Query Parameters:** Same as content push

**Request Body:** Same as content push

**Response:** Same format as fleet commands

---

## Analytics API

Collect and query telemetry events from devices.

### Ingest Events

```http
POST /analytics/ingest/:deviceFingerprint
```

Submit analytics events from a device. Events are encoded to CBOR for efficient storage.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `deviceFingerprint` | number | Numeric device identifier |

**Request Body:**

```json
{
  "events": [
    {
      "event_id": "550e8400e29b41d4a716446655440000",
      "timestamp_ms": 1705315200000,
      "type": "ERROR",
      "schema_version": 0x00010000,
      "payload": {
        "error_type": "DOWNLOAD_FAILED",
        "message": "Failed to download media",
        "component": "MediaDownloader",
        "is_fatal": false
      },
      "network": {
        "quality": "GOOD",
        "download_mbps": 25.5,
        "upload_mbps": 10.2,
        "connection_type": "WIFI",
        "signal_strength_dbm": -65
      }
    },
    {
      "event_id": "550e8400e29b41d4a716446655440001",
      "timestamp_ms": 1705315300000,
      "type": "HEARTBEAT",
      "payload": {
        "battery_level": 85.5,
        "storage_free_bytes": 2147483648,
        "cpu_usage": 23.4,
        "memory_usage": 45.2
      }
    }
  ],
  "queue": {
    "pending_events": 10,
    "oldest_event_age_hours": 2.5,
    "is_backpressure": false
  }
}
```

**Event Types:**
| Type | Description |
|------|-------------|
| `ERROR` | Application errors and exceptions |
| `IMPRESSION` | Content playback/ad impressions |
| `HEARTBEAT` | Periodic health check-ins |
| `PERFORMANCE` | Performance metrics |
| `LIFECYCLE` | Device lifecycle events |

**Connection Quality Values:** `OFFLINE`, `POOR`, `FAIR`, `GOOD`, `EXCELLENT`

**Connection Type Values:** `WIFI`, `ETHERNET`, `CELLULAR_4G`, `CELLULAR_5G`, `CELLULAR_3G`, `CELLULAR_2G`, `UNKNOWN`

**Response (201 Created):**

```json
{
  "accepted": true,
  "batch_id": "a1b2c3d4e5f6...",
  "events_received": 2,
  "events_stored": 2,
  "rejected_event_ids": [],
  "policy": {
    "min_quality_for_regular": 3,
    "min_quality_for_urgent": 1,
    "max_events_per_batch": 100,
    "upload_interval_seconds": 300
  }
}
```

---

### Get Upload Policy

```http
GET /analytics/policy
```

Get the server's current upload policy for devices.

**Response:**

```json
{
  "min_quality_for_regular": 3,
  "min_quality_for_urgent": 1,
  "max_events_per_batch": 100,
  "upload_interval_seconds": 300
}
```

| Field | Description |
|-------|-------------|
| `min_quality_for_regular` | Minimum connection quality for regular uploads (3 = FAIR) |
| `min_quality_for_urgent` | Minimum quality for urgent/error uploads (1 = OFFLINE) |
| `max_events_per_batch` | Maximum events per batch upload |
| `upload_interval_seconds` | Recommended seconds between uploads |

---

### Query Events

```http
GET /analytics/events
```

Query events with filters.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `device_fingerprint` | number | Filter by device |
| `type` | string | Filter by event type |
| `from` | number | Start timestamp (ms) |
| `to` | number | End timestamp (ms) |
| `limit` | number | Max results (default: 100) |

**Example:**
```
GET /analytics/events?device_fingerprint=12345&type=ERROR&limit=50
```

**Response:**

```json
{
  "total": 25,
  "events": [
    {
      "eventId": "550e8400...",
      "deviceFingerprint": 12345,
      "batchId": "a1b2c3d4...",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "type": "ERROR",
      "schemaVersion": "1.0.0",
      "payload": { /* CBOR-decoded payload */ },
      "network": {
        "quality": "GOOD",
        "downloadMbps": 25.5,
        ...
      }
    }
  ]
}
```

---

### Get Single Event

```http
GET /analytics/events/:eventId
```

Get a specific event by its ID.

**Response:** Event object (see Query Events)

---

### Get Device Events

```http
GET /analytics/devices/:deviceFingerprint/events
```

Get all events for a specific device.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `type` | string | Filter by event type |
| `limit` | number | Max results (default: 100) |

---

### Get Device Summary

```http
GET /analytics/devices/:deviceFingerprint/summary
```

Get analytics summary for a device.

**Response:**

```json
{
  "deviceFingerprint": 12345,
  "lastSeen": "2024-01-15T10:30:00.000Z",
  "totalEvents": 150,
  "eventsByType": {
    "ERROR": 5,
    "IMPRESSION": 100,
    "HEARTBEAT": 40,
    "PERFORMANCE": 5,
    "LIFECYCLE": 0
  },
  "lastNetworkQuality": "GOOD"
}
```

---

### List Devices with Analytics

```http
GET /analytics/devices
```

Get a list of all devices that have submitted analytics events.

**Response:**

```json
{
  "total": 10,
  "devices": [
    {
      "deviceFingerprint": 12345,
      "lastSeen": "2024-01-15T10:30:00.000Z",
      "totalEvents": 150,
      "eventsByType": { ... }
    }
  ]
}
```

---

### Get Global Summary

```http
GET /analytics/summary
```

Get global analytics summary across all devices.

**Response:**

```json
{
  "totalDevices": 10,
  "totalEvents": 1500,
  "storageLimit": 50000,
  "storageUsagePercent": 3
}
```

---

### Get Global Stats

```http
GET /analytics/stats
```

Get event counts by type across all devices.

**Response:**

```json
{
  "totalEvents": 1500,
  "byType": {
    "ERROR": 50,
    "IMPRESSION": 1000,
    "HEARTBEAT": 400,
    "PERFORMANCE": 50,
    "LIFECYCLE": 0,
    "UNKNOWN": 0
  }
}
```

---

## Error Handling

### HTTP Status Codes

| Status | Meaning | When Returned |
|--------|---------|---------------|
| `200 OK` | Success | Request completed successfully |
| `201 Created` | Created | Fleet or resource created successfully |
| `207 Partial Content` | Partial Success | Fleet broadcast: some devices succeeded |
| `400 Bad Request` | Invalid Request | Missing required fields, invalid JSON |
| `404 Not Found` | Not Found | Fleet, device, or event doesn't exist |
| `408 Request Timeout` | ACK Timeout | Device didn't acknowledge in time |
| `502 Bad Gateway` | Delivery Failed | Command/content delivery failed or all fleet devices failed |
| `503 Service Unavailable` | Device Offline | Target device is not connected |

### Error Response Format

```json
{
  "success": false,
  "message": "Fleet not found",
  "device_id": "device-001",
  "delivery_id": "pkg-123",
  "timed_out": false
}
```

---

## Best Practices

### 1. Use Appropriate Timeouts

Default 5-second timeout may not be enough for large content packages:

```bash
# For large content packages, increase timeout
curl -X POST "http://localhost:31691/content/push/device-001?timeout=30000" \
  -H "Content-Type: application/json" \
  -d @large-package.json
```

### 2. Handle Partial Success in Fleet Operations

Fleet operations often result in partial success. Always check the response:

```typescript
const response = await fetch(`/fleets/${fleetId}/commands/reboot`, {
  method: 'POST',
  body: JSON.stringify({ delay_seconds: 10 })
});

if (response.status === 207) {
  const result = await response.json();
  console.log(`${result.successful} devices rebooted, ${result.failed} failed`);
  // Handle failures appropriately
}
```

### 3. Check Device Connection Before Commands

Query connected devices before sending critical commands:

```bash
# Check if device is connected
curl http://localhost:31691/commands/devices | jq '.devices[] | select(.device_id == "device-001")'
```

### 4. Use Fleets for Bulk Operations

Instead of looping over devices, use fleet operations:

```bash
# Create fleet with devices
curl -X POST http://localhost:31691/fleets \
  -H "Content-Type: application/json" \
  -d '{"id": "promo-fleet", "name": "Promo Displays"}'

# Add devices
curl -X POST http://localhost:31691/fleets/promo-fleet/devices/device-001
curl -X POST http://localhost:31691/fleets/promo-fleet/devices/device-002

# Push content to all at once
curl -X POST http://localhost:31691/fleets/promo-fleet/content/push \
  -H "Content-Type: application/json" \
  -d @content-package.json
```

### 5. Handle Event ID Format in Analytics

Event IDs must be 16-byte hex strings (32 hex characters):

```typescript
// Generate valid event ID
function generateEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
// Result: "550e8400e29b41d4a716446655440000"
```

### 6. Implement Retry Logic

Devices may be temporarily offline. Implement exponential backoff:

```typescript
async function pushWithRetry(deviceId: string, content: object, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(`/content/push/${deviceId}`, {
      method: 'POST',
      body: JSON.stringify(content)
    });
    
    if (response.status === 503) {
      // Device offline, wait and retry
      await delay(Math.pow(2, i) * 1000);
      continue;
    }
    
    return response;
  }
  throw new Error('Max retries exceeded');
}
```

### 7. Monitor Fleet Health

Regularly check fleet connectivity:

```bash
# Get all fleets
FLEETS=$(curl -s http://localhost:31691/fleets | jq -r '.fleets[].id')

# For each fleet, check which devices are connected
for FLEET in $FLEETS; do
  echo "Checking fleet: $FLEET"
  DEVICES=$(curl -s http://localhost:31691/fleets/$FLEET/devices | jq -r '.members[].deviceId')
  CONNECTED=$(curl -s http://localhost:31691/commands/devices | jq -r '.devices[].device_id')
  
  for DEVICE in $DEVICES; do
    if echo "$CONNECTED" | grep -q "$DEVICE"; then
      echo "  ✓ $DEVICE connected"
    else
      echo "  ✗ $DEVICE offline"
    fi
  done
done
```

---

## Example: Complete Content Delivery Workflow

```bash
#!/bin/bash

SERVER="http://localhost:31691"
DEVICE="device-001"

# 1. Check if device is connected
CONNECTED=$(curl -s "$SERVER/commands/devices" | jq -r ".devices[] | select(.device_id == \"$DEVICE\") | .device_id")

if [ -z "$CONNECTED" ]; then
  echo "❌ Device $DEVICE is not connected"
  exit 1
fi

echo "✅ Device $DEVICE is connected"

# 2. Push content with 10-second timeout
RESPONSE=$(curl -s -X POST "$SERVER/content/push/$DEVICE?timeout=10000" \
  -H "Content-Type: application/json" \
  -d "{
    \"delivery_id\": \"holiday-campaign-2024\",
    \"requires_ack\": true,
    \"content\": {
      \"id\": 1,
      \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"time_slots\": [{
        \"id\": \"main\",
        \"start_window\": \"00:00\",
        \"end_window\": \"23:59\",
        \"campaigns\": [{ \"id\": \"holiday-main\", \"index\": 0, \"media_id\": \"holiday-video\" }]
      }]
    },
    \"media\": [{
      \"id\": \"holiday-video\",
      \"checksum\": \"md5:abc123\",
      \"url\": \"https://cdn.example.com/holiday.mp4\"
    }]
  }")

# 3. Check response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')

if [ "$SUCCESS" = "true" ]; then
  echo "✅ Content delivered successfully"
  echo "$RESPONSE" | jq .
else
  echo "❌ Delivery failed"
  echo "$RESPONSE" | jq .
  exit 1
fi
```

---

## See Also

- [DEVICE_BEHAVIOR.md](./DEVICE_BEHAVIOR.md) - Device-side gRPC protocol documentation
- [Postman Collection](./Hydrogen-Node-Management-Server.postman_collection.json) - Importable API collection
