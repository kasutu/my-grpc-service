// Standalone test runner using Bun runtime (not bun test)
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { GrpcTestClient, delay } from './utils/grpc-client.util';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
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
      package: ['remote.v1', 'content.v1'],
      protoPath: ['src/command/v1/command.proto', 'src/content/v1/content.proto'],
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

  const tests = [
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
