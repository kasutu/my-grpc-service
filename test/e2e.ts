// Standalone test runner using Bun runtime (not bun test)
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { GrpcTestClient } from './utils/grpc-client.util';
import { delay } from './helpers/async';
import { AnalyticsFixture } from './fixtures/analytics.fixture';
import * as cbor from 'cbor';

let passed = 0;
let failed = 0;

import type { TestCase } from './types/test.types';

function test(name: string, fn: () => Promise<void>): TestCase {
  return { name, fn };
}

async function runTests() {
  console.log('Setting up test environment...\n');

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
      package: ['remote.v1', 'content.v1', 'analytics.v1'],
      protoPath: [
        'src/command/v1/command.proto',
        'src/content/v1/content.proto',
        'src/analytics/v1/analytics.proto',
      ],
      url: 'localhost:0',
    },
  });

  await app.startAllMicroservices();

  const grpcServer = (app as any).getMicroservices()[0].serverInstance.grpcClient;
  const boundPorts = grpcServer.boundPorts;
  const firstBinding = boundPorts.values().next().value;
  const grpcPort = firstBinding ? firstBinding.portNumber : 0;

  const grpcClient = new GrpcTestClient(grpcPort);
  grpcClient.connect();
  await delay(1000);

  async function subscribeDevice(deviceId: string) {
    const { commands } = grpcClient.subscribeCommands(deviceId);
    await delay(300);
    return { commands };
  }

  // Helper to ingest analytics via HTTP (v2 API)
  async function ingestAnalyticsHttp(deviceFingerprint: number, events: any[]) {
    const response = await fetch(`${httpUrl}/analytics/ingest/${deviceFingerprint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    return response;
  }

  // Helper to encode payload to CBOR
  function encodePayload(payload: Record<string, unknown>): Buffer {
    return cbor.encode(payload);
  }

  const tests: TestCase[] = [
    // Command Tests - Happy Path
    test('Command: send clock command and receive ACK', async () => {
      const deviceId = `clock-${Date.now()}`;
      const { commands } = await subscribeDevice(deviceId);

      const httpPromise = fetch(`${httpUrl}/commands/clock/${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulated_time: '2024-01-01T00:00:00Z' }),
      });

      await delay(500);
      if (commands.length === 0) throw new Error('No command received');

      // gRPC message uses snake_case due to keepCase: true in protoLoader
      const commandId = commands[0].command_id;
      await grpcClient.acknowledgeCommand(deviceId, commandId, true);

      const response = await httpPromise;
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      const body = await response.json();
      if (!body.success) throw new Error('Expected success');
    }),

    // Command Tests - Sad Path
    test('Command: return 503 when device offline', async () => {
      const response = await fetch(`${httpUrl}/commands/clock/offline-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulated_time: '2024-01-01T00:00:00Z' }),
      });
      if (response.status !== 503) throw new Error(`Expected 503, got ${response.status}`);
    }),

    test('Command: timeout when no ACK', async () => {
      const deviceId = `timeout-${Date.now()}`;
      await subscribeDevice(deviceId);

      const response = await fetch(`${httpUrl}/commands/clock/${deviceId}?timeout=500`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulated_time: '2024-01-01T00:00:00Z' }),
      });
      if (response.status !== 408) throw new Error(`Expected 408, got ${response.status}`);
    }),

    // Fleet Tests - Happy Path
    test('Fleet: create and get fleet', async () => {
      const createRes = await fetch(`${httpUrl}/fleets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Fleet' }),
      });
      if (createRes.status !== 201) throw new Error(`Expected 201, got ${createRes.status}`);

      const createBody = await createRes.json();
      const fleetId = createBody.fleet.id;

      const getRes = await fetch(`${httpUrl}/fleets/${fleetId}`);
      if (getRes.status !== 200) throw new Error(`Expected 200, got ${getRes.status}`);

      const getBody = await getRes.json();
      if (getBody.name !== 'Test Fleet') throw new Error('Fleet name mismatch');
    }),

    // Fleet Tests - Sad Path
    test('Fleet: return 404 for non-existent fleet', async () => {
      const response = await fetch(`${httpUrl}/fleets/non-existent-id`);
      if (response.status !== 404) throw new Error(`Expected 404, got ${response.status}`);
    }),

    // Analytics v2 Tests - gRPC Ingest
    test('Analytics v2: ingest valid batch via gRPC', async () => {
      const deviceFingerprint = 0x12345678;
      const batchId = AnalyticsFixture.generateBatchIdBytes();
      const payload = AnalyticsFixture.createImpressionPayload({
        campaignId: 'campaign-001',
        playCount: 5,
      });

      const response = await grpcClient.ingest({
        batch_id: batchId,
        events: [
          {
            event_id: AnalyticsFixture.generateEventIdBytes(),
            timestamp_ms: Date.now(),
            type: 'IMPRESSION',
            schema_version: 0x00010000,
            payload: encodePayload(payload),
            network: {
              quality: 'GOOD',
              download_mbps: 10.5,
              upload_mbps: 5.0,
              connection_type: 'wifi',
              signal_strength_dbm: -50,
            },
          },
        ],
        device_fingerprint: deviceFingerprint,
        sent_at_ms: Date.now(),
      });

      if (!response.accepted) throw new Error(`Batch rejected`);
      if (response.rejected_event_ids && response.rejected_event_ids.length > 0) {
        throw new Error('Some events were rejected');
      }
      if (!response.policy) throw new Error('Missing upload policy');
    }),

    test('Analytics v2: reject batch with empty events', async () => {
      const response = await grpcClient.ingest({
        batch_id: AnalyticsFixture.generateBatchIdBytes(),
        events: [],
        device_fingerprint: 0x99999999,
        sent_at_ms: Date.now(),
      });

      if (response.accepted) throw new Error('Should reject empty events');
    }),

    test('Analytics v2: reject oversized batch', async () => {
      const events = Array(150)
        .fill(null)
        .map(() => ({
          event_id: AnalyticsFixture.generateEventIdBytes(),
          timestamp_ms: Date.now(),
          type: 'IMPRESSION' as const,
          schema_version: 0x00010000,
          payload: encodePayload(AnalyticsFixture.createImpressionPayload()),
        }));

      const response = await grpcClient.ingest({
        batch_id: AnalyticsFixture.generateBatchIdBytes(),
        events,
        device_fingerprint: 0x88888888,
        sent_at_ms: Date.now(),
      });

      if (response.accepted) throw new Error('Should reject oversized batch');
    }),

    // Analytics v2 Tests - HTTP API
    test('Analytics v2: HTTP POST /analytics/ingest/:deviceFingerprint', async () => {
      const deviceFingerprint = 0x65432100;

      const response = await fetch(`${httpUrl}/analytics/ingest/${deviceFingerprint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [
            {
              event_id: AnalyticsFixture.generateUuid(),
              timestamp_ms: Date.now(),
              type: 'IMPRESSION',
              schema_version: 0x00010000,
              payload: { c: 'campaign-http', p: 3, t: Date.now(), d: 15000, v: 1 },
            },
          ],
        }),
      });

      if (response.status !== 201) {
        const body = await response.text();
        throw new Error(`Expected 201, got ${response.status}: ${body}`);
      }

      const body = await response.json();
      if (!body.accepted) throw new Error('Batch should be accepted');
    }),

    test('Analytics v2: HTTP GET /analytics/devices returns list', async () => {
      const deviceFingerprint = 0x22223333;

      // First ingest some analytics
      await ingestAnalyticsHttp(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateUuid(),
          timestamp_ms: Date.now(),
          type: 'IMPRESSION',
          payload: { c: 'c1', p: 1, t: Date.now(), d: 5000, v: 1 },
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/devices`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (!Array.isArray(body.devices)) throw new Error('devices should be an array');

      const foundDevice = body.devices.find((d: any) => d.deviceFingerprint === deviceFingerprint);
      if (!foundDevice) throw new Error('Uploaded device not found in list');
    }),

    test('Analytics v2: HTTP GET /analytics/devices/:deviceFingerprint/events', async () => {
      const deviceFingerprint = 0x33334444;

      await ingestAnalyticsHttp(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateUuid(),
          timestamp_ms: Date.now(),
          type: 'IMPRESSION',
          payload: { c: 'c1', p: 1, t: Date.now(), d: 1000, v: 1 },
        },
        {
          event_id: AnalyticsFixture.generateUuid(),
          timestamp_ms: Date.now(),
          type: 'ERROR',
          payload: { code: 'TEST_ERROR', msg: 'test', v: 1 },
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/devices/${deviceFingerprint}/events`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.deviceFingerprint !== deviceFingerprint) throw new Error('Device fingerprint mismatch');
      if (body.totalEvents !== 2) throw new Error('Expected 2 events');
    }),

    test('Analytics v2: HTTP GET /analytics/devices/:deviceFingerprint/summary', async () => {
      const deviceFingerprint = 0x44445555;
      const timestamp = Date.now();

      await ingestAnalyticsHttp(deviceFingerprint, [
        {
          event_id: AnalyticsFixture.generateUuid(),
          timestamp_ms: timestamp,
          type: 'IMPRESSION',
          payload: { c: 'c1', p: 1, t: timestamp, d: 1000, v: 1 },
        },
        {
          event_id: AnalyticsFixture.generateUuid(),
          timestamp_ms: timestamp,
          type: 'ERROR',
          payload: { code: 'ERR', msg: 'test', v: 1 },
        },
        {
          event_id: AnalyticsFixture.generateUuid(),
          timestamp_ms: timestamp,
          type: 'HEARTBEAT',
          payload: { uptime: 3600000, battery: 50, v: 1 },
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/devices/${deviceFingerprint}/summary`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (body.deviceFingerprint !== deviceFingerprint) throw new Error('Device fingerprint mismatch');
      if (body.totalEvents !== 3) throw new Error('Expected 3 total events');
      if (body.eventsByType.IMPRESSION !== 1) throw new Error('Expected 1 impression');
      if (body.eventsByType.ERROR !== 1) throw new Error('Expected 1 error');
    }),

    test('Analytics v2: HTTP GET /analytics/devices/:deviceFingerprint/summary returns 404 for unknown', async () => {
      const response = await fetch(`${httpUrl}/analytics/devices/99999999/summary`);
      if (response.status !== 404) throw new Error(`Expected 404, got ${response.status}`);
    }),

    test('Analytics v2: HTTP GET /analytics/summary', async () => {
      const response = await fetch(`${httpUrl}/analytics/summary`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);

      const body = await response.json();
      if (typeof body.totalDevices !== 'number') throw new Error('totalDevices should be a number');
      if (typeof body.totalEvents !== 'number') throw new Error('totalEvents should be a number');
      if (body.storageLimit !== 50000) throw new Error('storageLimit should be 50000');
    }),
  ];

  console.log(`Running ${tests.length} tests...\n`);

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
  console.error('Test runner error:', err);
  process.exit(1);
});
