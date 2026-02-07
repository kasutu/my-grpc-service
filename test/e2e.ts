// Standalone test runner using Bun runtime (not bun test)
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { GrpcTestClient } from './utils/grpc-client.util';
import { delay } from './helpers/async';
import { AnalyticsFixture } from './fixtures/analytics.fixture';

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

  // Helper to create a fleet and return the ID
  async function createFleet(name: string, deviceIds: string[] = []): Promise<string> {
    const res = await fetch(`${httpUrl}/fleets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, deviceIds }),
    });
    const body = await res.json();
    return body.fleet.id;
  }

  // Helper to upload analytics batch using fixtures
  async function uploadAnalyticsBatch(deviceId: string, events: any[]) {
    return grpcClient.uploadBatch({
      device_id: deviceId,
      batch_id: AnalyticsFixture.generateBatchId(),
      timestamp_ms: Date.now(),
      events,
    });
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

    // Analytics Tests - gRPC UploadBatch
    test('Analytics: upload valid playback batch via gRPC', async () => {
      const batchId = AnalyticsFixture.generateBatchId();
      const deviceId = `analytics-device-${Date.now()}`;
      const event = AnalyticsFixture.createPlaybackEvent({
        campaignId: 'campaign-001',
        mediaId: 'media-001',
      });
      
      const response = await grpcClient.uploadBatch({
        device_id: deviceId,
        batch_id: batchId,
        timestamp_ms: Date.now(),
        events: [{
          event_id: event.eventId,
          timestamp_ms: event.timestampMs,
          category: 1, // PLAYBACK
          playback: {
            campaign_id: event.playback!.campaignId,
            media_id: event.playback!.mediaId,
            duration_ms: event.playback!.durationMs,
            completed: event.playback!.completed,
          },
        }],
        network_context: {
          quality: 2, // GOOD
          download_speed_mbps: 10.5,
          latency_ms: 50,
        },
        queue_status: {
          pending_count: 1,
          oldest_event_hours: 0,
        },
      });

      if (!response.accepted) throw new Error(`Batch rejected: ${response.rejection_reason}`);
      if (response.batch_id !== batchId) throw new Error('Batch ID mismatch');
      if (response.failed_event_ids.length > 0) throw new Error('Some events failed');
      if (!response.policy) throw new Error('Missing upload policy');
    }),

    test('Analytics: reject batch with missing device_id', async () => {
      const response = await grpcClient.uploadBatch({
        device_id: '',
        batch_id: `batch-${Date.now()}`,
        timestamp_ms: Date.now(),
        events: [{ event_id: 'evt-1', timestamp_ms: Date.now(), category: 1 }],
      });

      if (response.accepted) throw new Error('Should reject empty device_id');
      if (!response.rejection_reason.includes('device_id')) {
        throw new Error(`Wrong rejection reason: ${response.rejection_reason}`);
      }
    }),

    test('Analytics: reject batch with empty events', async () => {
      const response = await grpcClient.uploadBatch({
        device_id: 'test-device',
        batch_id: `batch-${Date.now()}`,
        timestamp_ms: Date.now(),
        events: [],
      });

      if (response.accepted) throw new Error('Should reject empty events');
      if (!response.rejection_reason.includes('Empty')) {
        throw new Error(`Wrong rejection reason: ${response.rejection_reason}`);
      }
    }),

    test('Analytics: reject oversized batch', async () => {
      const events = Array(150).fill(null).map((_, i) => ({
        event_id: `evt-${i}`,
        timestamp_ms: Date.now(),
        category: 1,
      }));

      const response = await grpcClient.uploadBatch({
        device_id: 'test-device',
        batch_id: `batch-${Date.now()}`,
        timestamp_ms: Date.now(),
        events,
      });

      if (response.accepted) throw new Error('Should reject oversized batch');
      if (!response.rejection_reason.includes('exceeds')) {
        throw new Error(`Wrong rejection reason: ${response.rejection_reason}`);
      }
    }),

    // Analytics Tests - HTTP API
    test('Analytics: HTTP GET /analytics/devices returns list', async () => {
      const deviceId = `http-analytics-${Date.now()}`;
      
      // First upload some analytics using fixture
      await uploadAnalyticsBatch(deviceId, [{
        event_id: AnalyticsFixture.generateEventId(),
        timestamp_ms: Date.now(),
        category: 1,
        playback: {
          campaign_id: 'campaign-http',
          media_id: 'media-http',
          duration_ms: 3000,
          completed: true,
        },
      }]);

      const response = await fetch(`${httpUrl}/analytics/devices`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (!Array.isArray(body.devices)) throw new Error('devices should be an array');
      
      const foundDevice = body.devices.find((d: any) => d.deviceId === deviceId);
      if (!foundDevice) throw new Error('Uploaded device not found in list');
      if (foundDevice.totalEvents !== 1) throw new Error('Expected 1 event');
    }),

    test('Analytics: HTTP GET /analytics/devices/:id/events', async () => {
      const deviceId = `http-events-${Date.now()}`;
      
      await uploadAnalyticsBatch(deviceId, [
        {
          event_id: AnalyticsFixture.generateEventId(),
          timestamp_ms: Date.now(),
          category: 1,
          playback: { campaign_id: 'c1', media_id: 'm1', duration_ms: 1000, completed: true },
        },
        {
          event_id: AnalyticsFixture.generateEventId(),
          timestamp_ms: Date.now(),
          category: 1,
          playback: { campaign_id: 'c2', media_id: 'm2', duration_ms: 2000, completed: true },
        },
      ]);

      const response = await fetch(`${httpUrl}/analytics/devices/${deviceId}/events`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (body.deviceId !== deviceId) throw new Error('Device ID mismatch');
      if (body.totalEvents !== 2) throw new Error('Expected 2 events');
      if (body.events.length !== 2) throw new Error('Expected 2 events in array');
    }),

    test('Analytics: HTTP GET /analytics/devices/:id/summary', async () => {
      const deviceId = `http-summary-${Date.now()}`;
      const timestamp = Date.now();
      
      await uploadAnalyticsBatch(deviceId, [
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: timestamp, category: 1, playback: { campaign_id: 'c1', media_id: 'm1', duration_ms: 1000, completed: true } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: timestamp, category: 2, error: { error_type: 'TEST_ERROR', message: 'test', component: 'test', is_fatal: false } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: timestamp, category: 3, health: { battery_level: 50, storage_free_bytes: 1000000, cpu_usage: 10, memory_usage: 20, connection_quality: 2 } },
      ]);

      const response = await fetch(`${httpUrl}/analytics/devices/${deviceId}/summary`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (body.deviceId !== deviceId) throw new Error('Device ID mismatch');
      if (body.totalEvents !== 3) throw new Error('Expected 3 total events');
      if (body.playbackCount !== 1) throw new Error('Expected 1 playback event');
      if (body.errorCount !== 1) throw new Error('Expected 1 error event');
    }),

    test('Analytics: HTTP GET /analytics/devices/:id/summary returns 404 for unknown', async () => {
      const response = await fetch(`${httpUrl}/analytics/devices/unknown-device-xyz/summary`);
      if (response.status !== 404) throw new Error(`Expected 404, got ${response.status}`);
    }),

    test('Analytics: HTTP GET /analytics/fleets/:id returns fleet analytics', async () => {
      const deviceId = `fleet-device-${Date.now()}`;
      const fleetId = await createFleet('Analytics Test Fleet', [deviceId]);
      
      // Upload analytics for the fleet device using helper
      await uploadAnalyticsBatch(deviceId, [
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 1, playback: { campaign_id: 'c1', media_id: 'm1', duration_ms: 5000, completed: true } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 2, error: { error_type: 'NETWORK', message: 'timeout', component: 'Downloader', is_fatal: false } },
      ]);

      const response = await fetch(`${httpUrl}/analytics/fleets/${fleetId}`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (body.fleetId !== fleetId) throw new Error('Fleet ID mismatch');
      if (body.totalDevices !== 1) throw new Error('Expected 1 device');
      if (!body.playbackStats) throw new Error('Missing playbackStats');
      if (!body.errorStats) throw new Error('Missing errorStats');
      if (!body.healthOverview) throw new Error('Missing healthOverview');
    }),

    test('Analytics: HTTP GET /analytics/fleets/:id returns 404 for non-existent', async () => {
      const response = await fetch(`${httpUrl}/analytics/fleets/non-existent-fleet-xyz`);
      if (response.status !== 404) throw new Error(`Expected 404, got ${response.status}`);
    }),

    test('Analytics: HTTP GET /analytics/fleets/:id/playback', async () => {
      const deviceId = `playback-device-${Date.now()}`;
      const fleetId = await createFleet('Playback Test Fleet', [deviceId]);
      
      await uploadAnalyticsBatch(deviceId, [
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 1, playback: { campaign_id: 'campaign-1', media_id: 'm1', duration_ms: 5000, completed: true } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 1, playback: { campaign_id: 'campaign-1', media_id: 'm2', duration_ms: 3000, completed: true } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 1, playback: { campaign_id: 'campaign-2', media_id: 'm3', duration_ms: 4000, completed: true } },
      ]);

      const response = await fetch(`${httpUrl}/analytics/fleets/${fleetId}/playback`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (body.totalPlays !== 3) throw new Error(`Expected 3 plays, got ${body.totalPlays}`);
      if (body.uniqueCampaigns !== 2) throw new Error(`Expected 2 unique campaigns, got ${body.uniqueCampaigns}`);
      if (!Array.isArray(body.campaignBreakdown)) throw new Error('campaignBreakdown should be an array');
    }),

    test('Analytics: HTTP GET /analytics/fleets/:id/errors', async () => {
      const deviceId = `error-device-${Date.now()}`;
      const fleetId = await createFleet('Error Test Fleet', [deviceId]);
      
      await uploadAnalyticsBatch(deviceId, [
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 2, error: { error_type: 'NETWORK', message: 'timeout', component: 'Downloader', is_fatal: false } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 2, error: { error_type: 'NETWORK', message: 'timeout', component: 'Downloader', is_fatal: false } },
        { event_id: AnalyticsFixture.generateEventId(), timestamp_ms: Date.now(), category: 2, error: { error_type: 'PARSE', message: 'invalid json', component: 'Parser', is_fatal: true } },
      ]);

      const response = await fetch(`${httpUrl}/analytics/fleets/${fleetId}/errors`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (body.totalErrors !== 3) throw new Error(`Expected 3 errors, got ${body.totalErrors}`);
      if (body.fatalErrors !== 1) throw new Error(`Expected 1 fatal error, got ${body.fatalErrors}`);
      if (!Array.isArray(body.byComponent)) throw new Error('byComponent should be an array');
      if (!Array.isArray(body.byType)) throw new Error('byType should be an array');
    }),

    test('Analytics: HTTP GET /analytics/summary', async () => {
      const response = await fetch(`${httpUrl}/analytics/summary`);
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      
      const body = await response.json();
      if (typeof body.totalDevices !== 'number') throw new Error('totalDevices should be a number');
      if (typeof body.totalEvents !== 'number') throw new Error('totalEvents should be a number');
      if (body.storageLimit !== 50000) throw new Error('storageLimit should be 50000');
      if (typeof body.storageUsagePercent !== 'number') throw new Error('storageUsagePercent should be a number');
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

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
