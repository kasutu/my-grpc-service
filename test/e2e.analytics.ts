// E2E tests for Analytics v2 - Minimal envelope + CBOR payload
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { GrpcTestClient } from "./utils/grpc-client.util";
import { delay } from "./helpers/async";
import { AnalyticsFixture } from "./fixtures/analytics.fixture";
import * as cbor from "cbor";

import type { TestCase } from "./types/test.types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): TestCase {
  return { name, fn };
}

async function runTests() {
  console.log("Setting up analytics v2 test environment...\n");

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.listen(0);
  const httpPort = app.getHttpServer().address().port;
  const httpUrl = `http://localhost:${httpPort}`;

  app.connectMicroservice({
    transport: 4,
    options: {
      package: ["remote.v1", "content.v1", "analytics.v1"],
      protoPath: [
        "src/command/v1/command.proto",
        "src/content/v1/content.proto",
        "src/analytics/v1/analytics.proto",
      ],
      url: "localhost:0",
    },
  });

  await app.startAllMicroservices();

  const grpcServer = (app as any).getMicroservices()[0].serverInstance
    .grpcClient;
  const boundPorts = grpcServer.boundPorts;
  const firstBinding = boundPorts.values().next().value;
  const grpcPort = firstBinding ? firstBinding.portNumber : 0;

  const grpcClient = new GrpcTestClient(grpcPort);
  grpcClient.connect();
  await delay(1000);

  // Helper to create a fleet and return the ID
  async function createFleet(
    name: string,
    deviceIds: string[] = [],
  ): Promise<string> {
    const res = await fetch(`${httpUrl}/fleets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, deviceIds }),
    });
    const body = await res.json();
    return body.fleet.id;
  }

  // Helper to ingest analytics via gRPC
  async function ingestAnalytics(deviceFingerprint: number, events: any[]) {
    return grpcClient.ingest({
      batch_id: AnalyticsFixture.generateBatchIdBytes(),
      events,
      device_fingerprint: deviceFingerprint,
      sent_at_ms: Date.now(),
    });
  }

  // Helper to create a CBOR payload
  function encodePayload(payload: Record<string, unknown>): Buffer {
    return cbor.encode(payload);
  }

  const tests: TestCase[] = [
    // Analytics v2 gRPC Tests - Happy Path
    test("Analytics v2: ingest valid impression batch via gRPC", async () => {
      const deviceFingerprint = 0x12345678;
      const batchId = AnalyticsFixture.generateBatchIdBytes();
      const payload = AnalyticsFixture.createImpressionPayload({
        campaignId: "campaign-001",
        playCount: 5,
      });

      const response = await grpcClient.ingest({
        batch_id: batchId,
        events: [
          {
            event_id: AnalyticsFixture.generateEventIdBytes(),
            timestamp_ms: Date.now(),
            type: "IMPRESSION",
            schema_version: 0x00010000,
            payload: encodePayload(payload),
            network: {
              quality: "GOOD",
              download_mbps: 10.5,
              upload_mbps: 5.0,
              connection_type: "wifi",
              signal_strength_dbm: -50,
            },
          },
        ],
        device_fingerprint: deviceFingerprint,
        sent_at_ms: Date.now(),
      });

      if (!response.accepted) throw new Error(`Batch rejected`);
      if (
        response.rejected_event_ids &&
        response.rejected_event_ids.length > 0
      ) {
        throw new Error("Some events were rejected");
      }
      if (!response.policy) throw new Error("Missing upload policy");
    }),

    test("Analytics v2: ingest multiple events in batch", async () => {
      const deviceFingerprint = 0xabcdef01;
      const batchId = AnalyticsFixture.generateBatchIdBytes();
      const now = Date.now();

      const response = await grpcClient.ingest({
        batch_id: batchId,
        events: [
          {
            event_id: AnalyticsFixture.generateEventIdBytes(),
            timestamp_ms: now,
            type: "IMPRESSION",
            schema_version: 0x00010000,
            payload: encodePayload(
              AnalyticsFixture.createImpressionPayload({ campaignId: "c1" }),
            ),
          },
          {
            event_id: AnalyticsFixture.generateEventIdBytes(),
            timestamp_ms: now,
            type: "ERROR",
            schema_version: 0x00010000,
            payload: encodePayload(
              AnalyticsFixture.createErrorPayload({ code: "NETWORK_ERROR" }),
            ),
          },
          {
            event_id: AnalyticsFixture.generateEventIdBytes(),
            timestamp_ms: now,
            type: "HEARTBEAT",
            schema_version: 0x00010000,
            payload: encodePayload(
              AnalyticsFixture.createHeartbeatPayload({ battery: 90 }),
            ),
          },
        ],
        device_fingerprint: deviceFingerprint,
        sent_at_ms: now,
      });

      if (!response.accepted) throw new Error("Batch should be accepted");
      if (
        response.rejected_event_ids &&
        response.rejected_event_ids.length > 0
      ) {
        throw new Error("Events should not be rejected");
      }
    }),

    test("Analytics v2: ingest with different network qualities", async () => {
      const qualities = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;

      for (const quality of qualities) {
        const response = await grpcClient.ingest({
          batch_id: AnalyticsFixture.generateBatchIdBytes(),
          events: [
            {
              event_id: AnalyticsFixture.generateEventIdBytes(),
              timestamp_ms: Date.now(),
              type: "IMPRESSION",
              schema_version: 0x00010000,
              payload: encodePayload(
                AnalyticsFixture.createImpressionPayload(),
              ),
              network: {
                quality: quality,
                download_mbps: 10,
                upload_mbps: 5,
                connection_type: "wifi",
                signal_strength_dbm: -50,
              },
            },
          ],
          device_fingerprint: 0x11110000 + qualities.indexOf(quality),
          sent_at_ms: Date.now(),
        });

        if (!response.accepted) {
          throw new Error(`Batch with ${quality} quality should be accepted`);
        }
      }
    }),

    // Analytics v2 gRPC Tests - Sad Path
    test("Analytics v2: reject batch with empty events", async () => {
      const response = await grpcClient.ingest({
        batch_id: AnalyticsFixture.generateBatchIdBytes(),
        events: [],
        device_fingerprint: 0x99999999,
        sent_at_ms: Date.now(),
      });

      if (response.accepted) throw new Error("Should reject empty events");
    }),

    test("Analytics v2: reject oversized batch", async () => {
      const events = Array(150)
        .fill(null)
        .map(() => ({
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: Date.now(),
          type: "IMPRESSION" as const,
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
        }));

      const response = await grpcClient.ingest({
        batch_id: AnalyticsFixture.generateBatchIdBytes(),
        events,
        device_fingerprint: 0x88888888,
        sent_at_ms: Date.now(),
      });

      if (response.accepted) throw new Error("Should reject oversized batch");
    }),

    test("Analytics v2: reject batch with invalid event_id length", async () => {
      const response = await grpcClient.ingest({
        batch_id: AnalyticsFixture.generateBatchIdBytes(),
        events: [
          {
            event_id: Buffer.from("short"), // Not 16 bytes
            timestamp_ms: Date.now(),
            type: "IMPRESSION",
            schema_version: 0x00010000,
            payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
          },
        ],
        device_fingerprint: 0x77777777,
        sent_at_ms: Date.now(),
      });

      // Should be partially rejected
      if (response.accepted) throw new Error("Should reject invalid event_id");
    }),

    // Analytics v2 HTTP Tests - Ingestion
    test("Analytics v2: HTTP POST /analytics/ingest/:deviceFingerprint", async () => {
      const deviceFingerprint = 0x65432100;

      const response = await fetch(
        `${httpUrl}/analytics/ingest/${deviceFingerprint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [
              {
                event_id: AnalyticsFixture.generateUuid(),
                timestamp_ms: Date.now(),
                type: "IMPRESSION",
                schema_version: 0x00010000,
                payload: {
                  c: "campaign-http",
                  p: 3,
                  t: Date.now(),
                  d: 15000,
                  v: 1,
                },
                network: {
                  quality: "GOOD",
                  download_mbps: 15.5,
                  upload_mbps: 8.0,
                  connection_type: "wifi",
                  signal_strength_dbm: -45,
                },
              },
            ],
            queue: {
              pending_events: 5,
              oldest_event_age_hours: 1,
              is_backpressure: false,
            },
          }),
        },
      );

      if (response.status !== 201) {
        const body = await response.text();
        throw new Error(`Expected 201, got ${response.status}: ${body}`);
      }

      const body = await response.json();
      if (!body.accepted) throw new Error("Batch should be accepted");
      if (body.events_received !== 1) throw new Error("Should receive 1 event");
      if (body.events_stored !== 1) throw new Error("Should store 1 event");
    }),

    test("Analytics v2: HTTP POST with multiple event types", async () => {
      const deviceFingerprint = 0x55554444;
      const now = Date.now();

      const response = await fetch(
        `${httpUrl}/analytics/ingest/${deviceFingerprint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [
              {
                event_id: AnalyticsFixture.generateUuid(),
                timestamp_ms: now,
                type: "IMPRESSION",
                payload: { c: "c1", p: 1, t: now, d: 5000, v: 1 },
              },
              {
                event_id: AnalyticsFixture.generateUuid(),
                timestamp_ms: now,
                type: "ERROR",
                payload: {
                  code: "DOWNLOAD_FAILED",
                  msg: "Network timeout",
                  component: "Downloader",
                  v: 1,
                },
              },
              {
                event_id: AnalyticsFixture.generateUuid(),
                timestamp_ms: now,
                type: "HEARTBEAT",
                payload: { uptime: 3600000, battery: 75, v: 1 },
              },
              {
                event_id: AnalyticsFixture.generateUuid(),
                timestamp_ms: now,
                type: "PERFORMANCE",
                payload: { cpu: 30, memory: 45, fps: 60, v: 1 },
              },
              {
                event_id: AnalyticsFixture.generateUuid(),
                timestamp_ms: now,
                type: "LIFECYCLE",
                payload: {
                  action: "app_resume",
                  prevState: "background",
                  v: 1,
                },
              },
            ],
          }),
        },
      );

      if (response.status !== 201)
        throw new Error(`Expected 201, got ${response.status}`);

      const body = await response.json();
      if (body.events_stored !== 5)
        throw new Error(`Expected 5 events stored, got ${body.events_stored}`);
    }),

    test("Analytics v2: HTTP GET /analytics/policy", async () => {
      const response = await fetch(`${httpUrl}/analytics/policy`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (typeof body.min_quality !== "number")
        throw new Error("Missing min_quality");
      if (typeof body.max_batch_size !== "number")
        throw new Error("Missing max_batch_size");
      if (typeof body.max_queue_age_hours !== "number")
        throw new Error("Missing max_queue_age_hours");
      if (typeof body.upload_interval_seconds !== "number")
        throw new Error("Missing upload_interval_seconds");
    }),

    // Analytics v2 HTTP Tests - Querying
    test("Analytics v2: HTTP GET /analytics/events", async () => {
      // First ingest some events
      const deviceFingerprint = 0x44443333;
      await ingestAnalytics(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: Date.now(),
          type: "ERROR",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createErrorPayload()),
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/events`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (!Array.isArray(body.events))
        throw new Error("events should be an array");
      if (typeof body.total !== "number")
        throw new Error("total should be a number");
    }),

    test("Analytics v2: HTTP GET /analytics/events with filters", async () => {
      const deviceFingerprint = 0x33332222;
      const now = Date.now();

      // Ingest events
      await ingestAnalytics(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: now,
          type: "IMPRESSION",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
        },
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: now,
          type: "ERROR",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createErrorPayload()),
        },
      ]);

      // Query with device_fingerprint filter
      const response = await fetch(
        `${httpUrl}/analytics/events?device_fingerprint=${deviceFingerprint}`,
      );
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.events.length !== 2)
        throw new Error(`Expected 2 events, got ${body.events.length}`);

      // Query with type filter
      const errorResponse = await fetch(`${httpUrl}/analytics/events?type=1`); // ERROR = 1
      if (errorResponse.status !== 200)
        throw new Error(`Expected 200, got ${errorResponse.status}`);

      const errorBody = await errorResponse.json();
      if (!Array.isArray(errorBody.events))
        throw new Error("events should be an array");
    }),

    test("Analytics v2: HTTP GET /analytics/events/:eventId", async () => {
      const deviceFingerprint = 0x22221111;
      const eventId = AnalyticsFixture.generateEventIdBytes();
      const eventIdHex = eventId.toString("hex");

      await ingestAnalytics(deviceFingerprint, [
        {
          event_id: eventId,
          timestamp_ms: Date.now(),
          type: "IMPRESSION",
          schema_version: 0x00010000,
          payload: encodePayload(
            AnalyticsFixture.createImpressionPayload({
              campaignId: "test-campaign",
            }),
          ),
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/events/${eventIdHex}`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.eventId !== eventIdHex) throw new Error("Event ID mismatch");
      if (body.type !== "IMPRESSION") throw new Error("Type mismatch");
    }),

    test("Analytics v2: HTTP GET /analytics/events/:eventId returns 404 for unknown", async () => {
      const response = await fetch(
        `${httpUrl}/analytics/events/unknown-event-id`,
      );
      if (response.status !== 404)
        throw new Error(`Expected 404, got ${response.status}`);
    }),

    // Analytics v2 HTTP Tests - Device Analytics
    test("Analytics v2: HTTP GET /analytics/devices", async () => {
      const deviceFingerprint = 0x11110000;
      await ingestAnalytics(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: Date.now(),
          type: "HEARTBEAT",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createHeartbeatPayload()),
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/devices`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (!Array.isArray(body.devices))
        throw new Error("devices should be an array");

      const foundDevice = body.devices.find(
        (d: any) => d.deviceFingerprint === deviceFingerprint,
      );
      if (!foundDevice) throw new Error("Device not found in list");
    }),

    test("Analytics v2: HTTP GET /analytics/devices/:deviceFingerprint/events", async () => {
      const deviceFingerprint = 0xaaaa0000;

      await ingestAnalytics(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: Date.now(),
          type: "IMPRESSION",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
        },
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: Date.now(),
          type: "IMPRESSION",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
        },
      ]);

      const response = await fetch(
        `${httpUrl}/analytics/devices/${deviceFingerprint}/events`,
      );
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.deviceFingerprint !== deviceFingerprint)
        throw new Error("Device fingerprint mismatch");
      if (body.totalEvents !== 2)
        throw new Error(`Expected 2 events, got ${body.totalEvents}`);
    }),

    test("Analytics v2: HTTP GET /analytics/devices/:deviceFingerprint/summary", async () => {
      const deviceFingerprint = 0xbbbb0000;
      const now = Date.now();

      await ingestAnalytics(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: now,
          type: "IMPRESSION",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
        },
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: now,
          type: "ERROR",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createErrorPayload()),
        },
        {
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: now,
          type: "HEARTBEAT",
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createHeartbeatPayload()),
        },
      ]);

      const response = await fetch(
        `${httpUrl}/analytics/devices/${deviceFingerprint}/summary`,
      );
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.deviceFingerprint !== deviceFingerprint)
        throw new Error("Device fingerprint mismatch");
      if (body.totalEvents !== 3)
        throw new Error(`Expected 3 events, got ${body.totalEvents}`);
      if (body.eventsByType.IMPRESSION !== 1)
        throw new Error("Expected 1 impression");
      if (body.eventsByType.ERROR !== 1) throw new Error("Expected 1 error");
      if (body.eventsByType.HEARTBEAT !== 1)
        throw new Error("Expected 1 heartbeat");
    }),

    test("Analytics v2: HTTP GET /analytics/devices/:deviceFingerprint/summary returns 404 for unknown", async () => {
      const response = await fetch(
        `${httpUrl}/analytics/devices/99999999/summary`,
      );
      if (response.status !== 404)
        throw new Error(`Expected 404, got ${response.status}`);
    }),

    // Analytics v2 HTTP Tests - Global Stats
    test("Analytics v2: HTTP GET /analytics/summary", async () => {
      const response = await fetch(`${httpUrl}/analytics/summary`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (typeof body.totalDevices !== "number")
        throw new Error("totalDevices should be a number");
      if (typeof body.totalEvents !== "number")
        throw new Error("totalEvents should be a number");
      if (body.storageLimit !== 50000)
        throw new Error("storageLimit should be 50000");
    }),

    test("Analytics v2: HTTP GET /analytics/stats", async () => {
      const response = await fetch(`${httpUrl}/analytics/stats`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (typeof body.totalEvents !== "number")
        throw new Error("totalEvents should be a number");
      if (typeof body.byType !== "object")
        throw new Error("byType should be an object");
    }),

    // Analytics v2 HTTP Tests - Fleet Analytics
    test("Analytics v2: HTTP GET /analytics/fleets/:fleetId", async () => {
      // Note: Fleet analytics in v2 works differently - it uses device fingerprints
      // Create a fleet first
      const fleetId = await createFleet("Analytics v2 Test Fleet", []);

      const response = await fetch(`${httpUrl}/analytics/fleets/${fleetId}`);
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.fleetId !== fleetId) throw new Error("Fleet ID mismatch");
      if (typeof body.totalDevices !== "number")
        throw new Error("totalDevices should be a number");
    }),

    test("Analytics v2: HTTP GET /analytics/fleets/:fleetId returns 404 for non-existent", async () => {
      const response = await fetch(
        `${httpUrl}/analytics/fleets/non-existent-fleet-xyz`,
      );
      if (response.status !== 404)
        throw new Error(`Expected 404, got ${response.status}`);
    }),

    test("Analytics v2: HTTP GET /analytics/fleets/:fleetId/health", async () => {
      const fleetId = await createFleet("Health Test Fleet", []);

      const response = await fetch(
        `${httpUrl}/analytics/fleets/${fleetId}/health`,
      );
      if (response.status !== 200)
        throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (typeof body.totalDevices !== "number")
        throw new Error("totalDevices should be a number");
      if (typeof body.onlineDevices !== "number")
        throw new Error("onlineDevices should be a number");
      if (typeof body.offlineDevices !== "number")
        throw new Error("offlineDevices should be a number");
      if (!Array.isArray(body.deviceHealth))
        throw new Error("deviceHealth should be an array");
    }),
  ];

  console.log(`Running ${tests.length} analytics v2 tests...\n`);

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✓ ${t.name}`);
      passed++;
    } catch (err: any) {
      console.log(`✗ ${t.name}`);
      console.log(`  Error: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  grpcClient.disconnect();
  await app.close();

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
