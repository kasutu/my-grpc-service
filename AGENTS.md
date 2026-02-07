# AGENTS.md - AI Coding Agent Guide

This document provides essential context for AI coding agents working on this project.

## Project Overview

This is a **NestJS-based hybrid gRPC/HTTP server** for managing a fleet of IoT/display devices (referred to as "hydrogen nodes"). It provides real-time content delivery and remote command execution capabilities.

The server runs as a **hybrid application** - simultaneously exposing:
- **gRPC interface** (port 50051) for device communication (streaming content/commands)
- **HTTP REST API** (port 31691) for administrative operations

### Key Business Domain

- **Devices**: IoT displays that connect via gRPC streaming
- **Content**: Media packages (video/image campaigns with time slots) pushed to devices
- **Commands**: Remote operations (reboot, clock override, network config, screen rotation)
- **Fleets**: Logical groupings of devices for bulk operations

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun (not Node.js) |
| Framework | NestJS 11.x |
| Transport | gRPC (@grpc/grpc-js) + HTTP |
| Protocol Buffers | ts-proto (code generation) |
| Language | TypeScript 5.9 |
| Testing | Custom Bun-based test runner |
| Linting | ESLint 9 + Prettier |

## Project Structure

```
src/
├── main.ts                      # Application entry point
├── app.module.ts                # Root module
├── grpc-client.options.ts       # gRPC server configuration
│
├── content/                     # Content delivery module
│   ├── content.module.ts
│   ├── content.controller.ts        # gRPC streaming handler
│   ├── content-http.controller.ts   # HTTP REST endpoints
│   ├── content-publisher.service.ts # Publish content to devices
│   ├── interfaces/
│   │   └── content.mapper.ts        # JSON → Protobuf mapper
│   └── v1/content.proto             # Protobuf schema
│
├── command/                     # Remote command module
│   ├── command.module.ts
│   ├── command.controller.ts        # gRPC command streaming
│   ├── command-http.controller.ts   # HTTP command endpoints
│   ├── command-publisher.service.ts # Command delivery logic
│   ├── interfaces/
│   │   └── command.mapper.ts        # JSON → Protobuf mapper
│   └── v1/command.proto             # Protobuf schema
│
├── fleet/                       # Fleet management module
│   ├── fleet.module.ts
│   ├── fleet.controller.ts          # HTTP REST for fleet CRUD
│   ├── fleet.service.ts             # Fleet business logic
│   └── interfaces/fleet.types.ts    # TypeScript interfaces
│
├── analytics/                   # Analytics module
│   ├── analytics.module.ts
│   ├── analytics.controller.ts      # gRPC handler for batch uploads
│   ├── analytics-http.controller.ts # HTTP REST endpoints
│   ├── analytics.service.ts         # Batch processing logic
│   ├── services/
│   │   ├── analytics-store.service.ts   # Event storage with TTL
│   │   └── fleet-analytics.service.ts   # Fleet-level aggregation
│   ├── interfaces/
│   │   ├── analytics.mapper.ts      # JSON → Protobuf mapper
│   │   └── analytics.types.ts       # TypeScript interfaces
│   └── v1/analytics.proto
│
└── generated/                   # Auto-generated from proto files (DO NOT EDIT)
    ├── content/v1/content.ts
    ├── command/v1/command.ts
    └── analytics/v1/analytics.ts

test/
├── e2e.ts                       # End-to-end tests (Bun runtime)
└── utils/
    └── grpc-client.util.ts      # gRPC test client utilities
```

## Build and Run Commands

```bash
# Development (watch mode)
bun run start:dev

# Production build
bun run build

# Production run
bun run start:prod

# Proto generation (TypeScript from .proto files)
bun run proto:generate

# Proto generation with watch mode
bash ./proto.sh watch

# Testing
bun run test              # Run E2E tests
bun run test:unit         # Run Jest unit tests

# Code formatting
bun run format
```

### Important: Bun Runtime

This project uses **Bun** as the runtime, not Node.js. Key differences:
- Use `bun run` instead of `npm run` or `node`
- The lockfile is `bun.lock` (not package-lock.json)
- Test runner uses Bun APIs, not Jest (though Jest is available for unit tests)

## gRPC Protocol Definitions

### Content Service (`content.v1`)

**File**: `src/content/v1/content.proto`

Streaming service for content delivery to devices:
- `Subscribe(stream)` - Server streaming for content packages
- `Acknowledge(unary)` - Device acknowledges receipt

Key message: `ContentPackage` contains delivery_id, content (with time slots/campaigns), and media references.

### Remote Command Service (`remote.v1`)

**File**: `src/command/v1/command.proto`

Streaming service for device control:
- `SubscribeCommands(stream)` - Server streaming for commands
- `AcknowledgeCommand(unary)` - Device acknowledges execution

Command types (oneof in CommandPackage):
- `SetClockOverride` - Override device clock for testing
- `RequestSystemReboot` - Reboot device
- `UpdateNetworkConfig` - Change WiFi settings
- `RotateScreen` - Change screen orientation

### Analytics Service (`analytics.v1`)

**File**: `src/analytics/v1/analytics.proto`

Event ingestion service for device telemetry:
- `UploadBatch(unary)` - Submit batch of analytics events

**Event Types:**
- `PlaybackEvent` - Media playback lifecycle (campaign_id, media_id, duration, completed)
- `ErrorEvent` - Application errors (error_type, message, component, is_fatal)
- `HealthEvent` - Device metrics (battery, storage, cpu, memory, connection_quality)

**Storage:** Events stored in-memory with 7-day TTL, 50K event limit per store.

## Code Generation from Protobuf

The project uses `ts-proto` with NestJS support to generate TypeScript interfaces.

**Configuration** (in `proto.sh`):
```bash
--ts_proto_opt=nestJs=true
--ts_proto_opt=addGrpcMetadata=false
--ts_proto_opt=exportCommonSymbols=false
--ts_proto_opt=useOptionals=messages
```

**Workflow**:
1. Edit `.proto` files
2. Run `bun run proto:generate`
3. Generated code appears in `src/generated/`
4. Controllers use generated types (e.g., `ContentPackage`, `CommandPackage`)

**Important**: Never edit files in `src/generated/` directly.

## Architecture Patterns

### Hybrid Application Pattern

```typescript
// main.ts
const app = await NestFactory.create(AppModule);  // HTTP
app.connectMicroservice<MicroserviceOptions>(grpcClientOptions);  // gRPC
await app.startAllMicroservices();
await app.listen(31691);
```

### Dual Controller Pattern

Each functional module has two controllers:
1. **gRPC Controller** (e.g., `content.controller.ts`) - handles `@GrpcMethod` decorators
2. **HTTP Controller** (e.g., `content-http.controller.ts`) - handles `@Get/@Post` decorators

### Publisher Service Pattern

Services like `ContentPublisherService` manage:
- Device subscriptions (Map<deviceId, Subject>)
- Pending acknowledgments with timeout handling
- Broadcast operations to all connected devices

### Mapper Pattern

`ContentMapper` and `CommandMapper` convert snake_case JSON from HTTP requests to camelCase TypeScript interfaces matching protobuf definitions.

Example:
```typescript
// HTTP receives: { delivery_id: "123", requires_ack: true }
// Mapper converts to: { deliveryId: "123", requiresAck: true }
```

## Data Storage

**No database** - all storage is in-memory using JavaScript Maps:

- `ContentPublisherService.subscriptions` - Map<deviceId, Subject<ContentPackage>>
- `CommandPublisherService.subscriptions` - Map<deviceId, Subject<CommandPackage>>
- `FleetService.fleets` - Map<fleetId, Fleet>
- `FleetService.deviceToFleets` - Reverse index for device membership
- `AnalyticsStoreService.events` - Map<eventId, StoredAnalyticsEvent>
- `AnalyticsStoreService.deviceEvents` - Map<deviceId, Set<eventId>> index

**Implications**:
- Data is lost on server restart
- Designed for stateless horizontal scaling not supported
- Suitable for demonstration/prototype purposes

## HTTP API Endpoints

### Content API
```
POST   /content/push/:deviceId     # Push content to specific device
POST   /content/broadcast          # Broadcast to all connected devices
GET    /content/stats              # Get connected device count
```

### Commands API
```
GET    /commands/devices           # List connected devices
POST   /commands/clock/:deviceId   # Set clock override
POST   /commands/reboot/:deviceId  # Request reboot
POST   /commands/network/:deviceId # Update network config
POST   /commands/rotate/:deviceId  # Rotate screen
POST   /commands/broadcast/clock   # Broadcast clock to all
POST   /commands/broadcast/rotate  # Broadcast rotation to all
GET    /commands/stats             # Get connected count
```

### Fleet API
```
POST   /fleets                     # Create fleet
GET    /fleets                     # List all fleets
GET    /fleets/:fleetId            # Get fleet details
PATCH  /fleets/:fleetId            # Update fleet
DELETE /fleets/:fleetId            # Delete fleet

POST   /fleets/:fleetId/devices/:deviceId    # Add device to fleet
DELETE /fleets/:fleetId/devices/:deviceId    # Remove device
GET    /fleets/:fleetId/devices              # List fleet members
GET    /fleets/device/:deviceId/memberships  # Get device's fleets

POST   /fleets/:fleetId/commands/rotate      # Rotate all fleet screens
POST   /fleets/:fleetId/commands/reboot      # Reboot all fleet devices
POST   /fleets/:fleetId/commands/network     # Update fleet network
POST   /fleets/:fleetId/commands/clock       # Set fleet clock
POST   /fleets/:fleetId/content/push        # Push content to fleet
```

### Analytics API
```
POST   /analytics/batch/:deviceId          # Submit batch via HTTP
POST   /analytics/events/:deviceId         # Submit events (auto-creates batch)

GET    /analytics/events                   # Query events (filters: device_id, category, from, to)
GET    /analytics/events/:deviceId         # Get events for specific device

GET    /analytics/devices                  # List devices with analytics
GET    /analytics/devices/:deviceId/stats  # Get device statistics

GET    /analytics/fleets/:fleetId          # Get fleet analytics summary
GET    /analytics/fleets/:fleetId/playback # Fleet playback stats
GET    /analytics/fleets/:fleetId/errors   # Fleet error report
GET    /analytics/fleets/:fleetId/health   # Fleet health overview
GET    /analytics/fleets/:fleetId/events   # All events from fleet devices

GET    /analytics/summary                  # Global analytics summary
GET    /analytics/stats                    # Overall statistics

DELETE /analytics/events/:deviceId        # Clear device events
DELETE /analytics/events                   # Clear all events (admin)
```

### Analytics API Examples

**Submit playback event:**
```bash
curl -X POST http://localhost:31691/analytics/events/device-001 \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "event_id": "evt-001",
      "timestamp_ms": 1700000000000,
      "category": "PLAYBACK",
      "playback": {
        "campaign_id": "campaign-001",
        "media_id": "media-001",
        "duration_ms": 5000,
        "completed": true
      }
    }]
  }'
```

**Submit error event:**
```bash
curl -X POST http://localhost:31691/analytics/events/device-001 \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "event_id": "evt-002",
      "timestamp_ms": 1700000000000,
      "category": "ERROR",
      "error": {
        "error_type": "DOWNLOAD_FAILED",
        "message": "Failed to download media",
        "component": "MediaDownloader",
        "is_fatal": false
      }
    }]
  }'
```

**Submit health metrics:**
```bash
curl -X POST http://localhost:31691/analytics/events/device-001 \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "event_id": "evt-003",
      "timestamp_ms": 1700000000000,
      "category": "HEALTH",
      "health": {
        "battery_level": 85.5,
        "storage_free_bytes": 2147483648,
        "cpu_usage": 23.4,
        "memory_usage": 45.2,
        "connection_quality": 1
      }
    }]
  }'
```

**Query events with filters:**
```bash
# All events for device
curl http://localhost:31691/analytics/devices/device-001/events

# Filter by category
curl "http://localhost:31691/analytics/events?device_id=device-001&category=PLAYBACK"

# Time range filter
curl "http://localhost:31691/analytics/events?from=1700000000000&to=1700086400000"
```

**Get analytics summaries:**
```bash
# Device summary
curl http://localhost:31691/analytics/devices/device-001/summary

# Global summary
curl http://localhost:31691/analytics/summary

# List all devices with analytics
curl http://localhost:31691/analytics/devices
```

## Testing Strategy

### E2E Tests (`test/e2e.ts`)

Custom test runner using Bun (not Jest):
- Creates actual NestJS application with HTTP + gRPC
- Uses real gRPC client from `@grpc/grpc-js`
- Tests both happy paths and error cases
- Covers command delivery, fleet operations, timeout handling, analytics ingestion

**Test Coverage (18 tests):**
- Command: send/receive/acknowledge, offline handling, timeouts
- Fleet: CRUD operations, 404 handling
- Analytics: batch upload (gRPC), batch validation, HTTP endpoints, fleet aggregation

**Run**: `bun run test`

### Test Utilities

**`test/utils/grpc-client.util.ts`** - `GrpcTestClient` provides:
- `subscribeCommands(deviceId)` - Subscribe to command stream
- `acknowledgeCommand(...)` - Send command acknowledgment
- `subscribeContent(...)` - Subscribe to content stream
- `acknowledgeContent(...)` - Send content acknowledgment
- `uploadBatch(...)` - Submit analytics batch

**`test/fixtures/analytics.fixture.ts`** - Test data generators:
- `AnalyticsFixture.createPlaybackBatch()` - Generate playback events
- `AnalyticsFixture.createErrorBatch()` - Generate error events
- `AnalyticsFixture.createMixedBatch()` - Mixed event types
- `AnalyticsFixtures.validPlaybackBatch` - Pre-defined valid data
- `AnalyticsFixtures.invalidBatches` - Invalid data for error testing

### Unit Tests

Jest is configured for unit testing (rarely used in this project):
**Run**: `bun run test:unit`

## Code Style Guidelines

### ESLint Configuration

Key rules (see `eslint.config.mjs`):
- `@typescript-eslint/no-explicit-any`: `off` - Allows `any` when necessary
- `@typescript-eslint/no-floating-promises`: `off`
- `@typescript-eslint/no-unsafe-*`: `warn` - Warnings for unsafe operations
- `@typescript-eslint/ban-ts-comment`: `off` - Allows `@ts-ignore`

### TypeScript Conventions

- Use `type` imports for generated types: `import type { Foo } from '...'`
- Explicit return types on public methods preferred
- Interface names in PascalCase
- File names in kebab-case

### Error Handling

HTTP controllers use explicit status codes:
- `503 Service Unavailable` - Device not connected
- `408 Request Timeout` - ACK timeout
- `502 Bad Gateway` - Command/content delivery failed
- `207 Partial Content` - Fleet broadcast partially successful
- `404 Not Found` - Fleet/resource not found

## Security Considerations

1. **No Authentication** - The server has no auth layer; assume it runs in a private network
2. **No Input Validation** - HTTP body parsing uses `any` types; validation is minimal
3. **No Rate Limiting** - Devices can connect/reconnect without restriction
4. **In-Memory Storage** - Sensitive data in fleet metadata is ephemeral
5. **gRPC Reflection Enabled** - `ReflectionService` is enabled for debugging

## Common Development Tasks

### Adding a New Command Type

1. Add message to `src/command/v1/command.proto`:
```protobuf
message NewCommand {
  string param = 1;
}
```

2. Add to `CommandPackage` oneof:
```protobuf
oneof command {
  // ... existing commands
  NewCommand new_command = 6;
}
```

3. Run `bun run proto:generate`

4. Add mapper in `src/command/interfaces/command.mapper.ts`:
```typescript
private static toNewCommand(json: any): NewCommand {
  return { param: json.param ?? '' };
}
```

5. Add HTTP endpoint in `src/command/command-http.controller.ts`

### Adding a New gRPC Service

1. Create proto file in `src/<service>/v1/<service>.proto`
2. Update `grpc-client.options.ts` to include package and proto path
3. Generate code with `bun run proto:generate`
4. Create module, controller, and service following existing patterns
5. Import module in `app.module.ts`

### Debugging gRPC

The server includes gRPC reflection. Use tools like:
- `grpcurl` - Command-line gRPC client
- BloomRPC / Postman - GUI gRPC clients
- Server runs on `localhost:50051`

## Important Notes

1. **Bun Required** - Do not use `npm` or `node` commands; always use `bun`
2. **Generated Code** - Never edit `src/generated/` files manually
3. **In-Memory State** - Server restart clears all fleet/device data
4. **ACK Timeouts** - Default 5 seconds, configurable via `?timeout=10000` query param
5. **Device IDs** - Passed as `device_id` (snake_case) in gRPC, mapped internally to `deviceId` (camelCase)
