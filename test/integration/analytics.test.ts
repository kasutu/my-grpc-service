// Analytics Integration Tests - Standalone Bun runner
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GrpcTestClient, delay } from "../utils/grpc-client.util";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  return { name, fn };
}

async function runTests() {
  console.log("Setting up analytics test environment...\n");

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
      package: ["analytics.v1"],
      protoPath: ["src/analytics/v1/analytics.proto"],
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
  await delay(500);

  const tests = [
    // gRPC Analytics Tests
    test("Analytics gRPC: upload batch with playback events", async () => {
      const deviceId = `analytics-playback-${Date.now()}`;
      const batchId = `batch-${Date.now()}`;

      const response = await grpcClient.uploadBatch({
        device_id: deviceId,
        batch_id: batchId,
        timestamp_ms: Date.now(),
        events: [
          {
            event_id: `event-${Date.now()}-1`,
            timestamp_ms: Date.now(),
            category: 1, // PLAYBACK
            playback: {
              campaign_id: "campaign-123",
              media_id: "media-456",
              duration_ms: 15000,
              completed: true,
            },
          },
        ],
        network_context: {
          quality: 2, // GOOD
          download_speed_mbps: 25.5,
          latency_ms: 45,
        },
        queue_status: {
          pending_count: 0,
          oldest_event_hours: 0,
        },
      });

      if (!response.accepted) {
        throw new Error(`Batch not accepted: ${response.rejection_reason}`);
      }
      if (response.batch_id !== batchId) {
        throw new Error(
          `Batch ID mismatch: ${response.batch_id} !== ${batchId}`,
        );
      }
    }),

    test("Analytics gRPC: upload batch with error events", async () => {
      const deviceId = `analytics-error-${Date.now()}`;
      const batchId = `batch-${Date.now()}`;

      const response = await grpcClient.uploadBatch({
        device_id: deviceId,
        batch_id: batchId,
        timestamp_ms: Date.now(),
        events: [
          {
            event_id: `event-${Date.now()}-1`,
            timestamp_ms: Date.now(),
            category: 2, // ERROR
            error: {
              error_type: "DOWNLOAD_FAILED",
              message: "Failed to download media",
              component: "MediaDownloader",
              is_fatal: false,
            },
          },
        ],
      });

      if (!response.accepted) {
        throw new Error(`Batch not accepted: ${response.rejection_reason}`);
      }
    }),

    test("Analytics gRPC: upload batch with health events", async () => {
      const deviceId = `analytics-health-${Date.now()}`;
      const batchId = `batch-${Date.now()}`;

      const response = await grpcClient.uploadBatch({
        device_id: deviceId,
        batch_id: batchId,
        timestamp_ms: Date.now(),
        events: [
          {
            event_id: `event-${Date.now()}-1`,
            timestamp_ms: Date.now(),
            category: 3, // HEALTH
            health: {
              battery_level: 85.5,
              storage_free_bytes: 2147483648,
              cpu_usage: 23.4,
              memory_usage: 45.2,
              connection_quality: 1, // EXCELLENT
            },
          },
        ],
      });

      if (!response.accepted) {
        throw new Error(`Batch not accepted: ${response.rejection_reason}`);
      }
    }),

    test("Analytics gRPC: upload batch with multiple events", async () => {
      const deviceId = `analytics-multi-${Date.now()}`;
      const batchId = `batch-${Date.now()}`;
      const now = Date.now();

      const response = await grpcClient.uploadBatch({
        device_id: deviceId,
        batch_id: batchId,
        timestamp_ms: now,
        events: [
          {
            event_id: `event-${now}-1`,
            timestamp_ms: now - 2000,
            category: 1, // PLAYBACK
            playback: {
              campaign_id: "campaign-1",
              media_id: "media-1",
              duration_ms: 5000,
              completed: false,
            },
          },
          {
            event_id: `event-${now}-2`,
            timestamp_ms: now - 1000,
            category: 3, // HEALTH
            health: {
              battery_level: 90.0,
              storage_free_bytes: 1073741824,
              cpu_usage: 15.0,
              memory_usage: 30.0,
              connection_quality: 2,
            },
          },
          {
            event_id: `event-${now}-3`,
            timestamp_ms: now,
            category: 1, // PLAYBACK
            playback: {
              campaign_id: "campaign-2",
              media_id: "media-2",
              duration_ms: 10000,
              completed: true,
            },
          },
        ],
      });

      if (!response.accepted) {
        throw new Error(`Batch not accepted: ${response.rejection_reason}`);
      }
      if (response.failed_event_ids && response.failed_event_ids.length > 0) {
        throw new Error(
          `Some events failed: ${response.failed_event_ids.join(", ")}`,
        );
      }
    }),

    test("Analytics gRPC: receive upload policy in response", async () => {
      const deviceId = `analytics-policy-${Date.now()}`;
      const batchId = `batch-${Date.now()}`;

      const response = await grpcClient.uploadBatch({
        device_id: deviceId,
        batch_id: batchId,
        timestamp_ms: Date.now(),
        events: [
          {
            event_id: `event-${Date.now()}`,
            timestamp_ms: Date.now(),
            category: 1,
            playback: {
              campaign_id: "test",
              media_id: "test",
              duration_ms: 1000,
              completed: true,
            },
          },
        ],
      });

      if (!response.policy) {
        throw new Error("Expected upload policy in response");
      }
      if (
        !response.policy.max_batch_size ||
        response.policy.max_batch_size <= 0
      ) {
        throw new Error("Invalid max_batch_size in policy");
      }
      if (
        !response.policy.sync_interval_seconds ||
        response.policy.sync_interval_seconds <= 0
      ) {
        throw new Error("Invalid sync_interval_seconds in policy");
      }
    }),

    // HTTP API Tests
    test("Analytics HTTP: submit events via REST", async () => {
      const deviceId = `analytics-http-${Date.now()}`;

      const response = await fetch(`${httpUrl}/analytics/events/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              event_id: `http-event-${Date.now()}`,
              timestamp_ms: Date.now(),
              category: "PLAYBACK",
              playback: {
                campaign_id: "http-campaign",
                media_id: "http-media",
                duration_ms: 5000,
                completed: true,
              },
            },
          ],
        }),
      });

      if (response.status !== 200 && response.status !== 201) {
        const text = await response.text();
        throw new Error(`Expected 200/201, got ${response.status}: ${text}`);
      }

      const body = await response.json();
      if (!body.accepted) {
        throw new Error(`Events not accepted: ${body.rejection_reason}`);
      }
    }),

    test("Analytics HTTP: get device events", async () => {
      const deviceId = `analytics-get-${Date.now()}`;

      // First submit an event
      const postRes = await fetch(`${httpUrl}/analytics/events/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              event_id: `get-event-${Date.now()}`,
              timestamp_ms: Date.now(),
              category: "HEALTH",
              health: {
                battery_level: 75.0,
                cpu_usage: 20.0,
                memory_usage: 40.0,
                connection_quality: 3,
              },
            },
          ],
        }),
      });

      if (postRes.status !== 200 && postRes.status !== 201) {
        throw new Error(`Failed to submit event: ${postRes.status}`);
      }

      await delay(100);

      // Then retrieve events
      const response = await fetch(
        `${httpUrl}/analytics/devices/${deviceId}/events`,
      );
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }

      const body = await response.json();
      if (!body.events || body.events.length === 0) {
        throw new Error("Expected events in response");
      }
      if (body.deviceId !== deviceId) {
        throw new Error(`Device ID mismatch: ${body.deviceId} !== ${deviceId}`);
      }
    }),

    test("Analytics HTTP: get device summary", async () => {
      const deviceId = `analytics-summary-${Date.now()}`;

      // Submit multiple events
      const postRes = await fetch(`${httpUrl}/analytics/events/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              event_id: `summary-1-${Date.now()}`,
              timestamp_ms: Date.now(),
              category: "PLAYBACK",
              playback: {
                campaign_id: "camp-1",
                media_id: "media-1",
                duration_ms: 5000,
                completed: true,
              },
            },
            {
              event_id: `summary-2-${Date.now()}`,
              timestamp_ms: Date.now(),
              category: "ERROR",
              error: {
                error_type: "TEST_ERROR",
                message: "Test error",
                component: "Test",
                is_fatal: false,
              },
            },
          ],
        }),
      });

      if (postRes.status !== 200 && postRes.status !== 201) {
        throw new Error(`Failed to submit events: ${postRes.status}`);
      }

      await delay(100);

      const response = await fetch(
        `${httpUrl}/analytics/devices/${deviceId}/summary`,
      );
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }

      const body = await response.json();
      if (body.totalEvents !== 2) {
        throw new Error(`Expected 2 events, got ${body.totalEvents}`);
      }
      if (body.playbackCount !== 1) {
        throw new Error(`Expected 1 playback, got ${body.playbackCount}`);
      }
      if (body.errorCount !== 1) {
        throw new Error(`Expected 1 error, got ${body.errorCount}`);
      }
    }),

    test("Analytics HTTP: get global summary", async () => {
      const response = await fetch(`${httpUrl}/analytics/summary`);
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }

      const body = await response.json();
      if (typeof body.totalDevices !== "number") {
        throw new Error("Expected totalDevices in response");
      }
      if (typeof body.totalEvents !== "number") {
        throw new Error("Expected totalEvents in response");
      }
    }),

    test("Analytics HTTP: query events with filters", async () => {
      const deviceId = `analytics-filter-${Date.now()}`;

      // Submit events of different categories
      const postRes = await fetch(`${httpUrl}/analytics/events/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              event_id: `filter-1-${Date.now()}`,
              timestamp_ms: Date.now(),
              category: "PLAYBACK",
              playback: {
                campaign_id: "c1",
                media_id: "m1",
                duration_ms: 1000,
                completed: true,
              },
            },
            {
              event_id: `filter-2-${Date.now()}`,
              timestamp_ms: Date.now(),
              category: "HEALTH",
              health: {
                battery_level: 80,
                cpu_usage: 10,
                memory_usage: 20,
                connection_quality: 1,
              },
            },
          ],
        }),
      });

      if (postRes.status !== 200 && postRes.status !== 201) {
        throw new Error(`Failed to submit events: ${postRes.status}`);
      }

      await delay(100);

      // Query with category filter
      const response = await fetch(
        `${httpUrl}/analytics/events?device_id=${deviceId}&category=PLAYBACK`,
      );
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }

      const body = await response.json();
      // Should only return PLAYBACK events
      const playbackEvents = body.events.filter(
        (e: any) => e.category === "PLAYBACK",
      );
      if (playbackEvents.length === 0) {
        throw new Error("Expected at least one PLAYBACK event");
      }
    }),
  ];

  // Run all tests
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${t.name}`);
      console.log(
        `   Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      failed++;
    }
  }

  // Cleanup
  grpcClient.disconnect();
  await app.close();

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Analytics Tests: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
