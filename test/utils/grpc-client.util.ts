import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

export interface GrpcCommandClient {
  subscribeCommands(request: { deviceId: string }): grpc.ClientReadableStream<any>;
  acknowledgeCommand(
    request: {
      deviceId: string;
      commandId: string;
      processedSuccessfully: boolean;
      errorMessage?: string;
    },
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
}

export interface GrpcContentClient {
  subscribe(request: { deviceId: string; lastReceivedDeliveryId?: string }): grpc.ClientReadableStream<any>;
  acknowledge(
    request: {
      deviceId: string;
      deliveryId: string;
      processedSuccessfully: boolean;
      errorMessage?: string;
    },
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
}

export class GrpcTestClient {
  private commandClient: GrpcCommandClient | null = null;
  private contentClient: GrpcContentClient | null = null;
  private commandProto: any;
  private contentProto: any;

  constructor(private readonly grpcPort: number = 50051) {
    const srcDir = join(__dirname, '../../src');

    // Load command proto - package is remote.v1
    const commandPackageDefinition = protoLoader.loadSync(
      join(srcDir, 'command/v1/command.proto'),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    );
    this.commandProto = grpc.loadPackageDefinition(commandPackageDefinition);

    // Load content proto - package is content.v1
    const contentPackageDefinition = protoLoader.loadSync(
      join(srcDir, 'content/v1/content.proto'),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    );
    this.contentProto = grpc.loadPackageDefinition(contentPackageDefinition);
  }

  connect(): void {
    const address = `localhost:${this.grpcPort}`;

    // Create command client - package remote.v1
    const RemoteCommandService = this.commandProto.remote.v1.RemoteCommandService;
    this.commandClient = new RemoteCommandService(
      address,
      grpc.credentials.createInsecure(),
    ) as GrpcCommandClient;

    // Create content client - package content.v1
    const ContentService = this.contentProto.content.v1.ContentService;
    this.contentClient = new ContentService(
      address,
      grpc.credentials.createInsecure(),
    ) as GrpcContentClient;
  }

  disconnect(): void {
    if (this.commandClient) {
      (this.commandClient as any).close();
      this.commandClient = null;
    }
    if (this.contentClient) {
      (this.contentClient as any).close();
      this.contentClient = null;
    }
  }

  subscribeCommands(deviceId: string): {
    stream: grpc.ClientReadableStream<any>;
    commands: any[];
    errors: any[];
  } {
    if (!this.commandClient) {
      throw new Error('Command client not connected');
    }

    const commands: any[] = [];
    const errors: any[] = [];
    // Use snake_case to match proto field names (protoLoader with keepCase: true)
    const stream = this.commandClient.subscribeCommands({ device_id: deviceId } as any);

    stream.on('data', (command) => {
      commands.push(command);
    });

    stream.on('error', (error) => {
      errors.push(error);
    });

    return { stream, commands, errors };
  }

  async acknowledgeCommand(
    deviceId: string,
    commandId: string,
    processedSuccessfully: boolean = true,
    errorMessage: string = '',
  ): Promise<any> {
    if (!this.commandClient) {
      throw new Error('Command client not connected');
    }

    return new Promise((resolve, reject) => {
      this.commandClient!.acknowledgeCommand(
        {
          device_id: deviceId,
          command_id: commandId,
          processed_successfully: processedSuccessfully,
          error_message: errorMessage,
        } as any,
        (err, response) => {
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  subscribeContent(
    deviceId: string,
    lastReceivedDeliveryId?: string,
  ): {
    stream: grpc.ClientReadableStream<any>;
    contentPackages: any[];
    errors: any[];
  } {
    if (!this.contentClient) {
      throw new Error('Content client not connected');
    }

    const contentPackages: any[] = [];
    const errors: any[] = [];
    // Use snake_case to match proto field names (protoLoader with keepCase: true)
    const stream = this.contentClient.subscribe({
      device_id: deviceId,
      last_received_delivery_id: lastReceivedDeliveryId || '',
    } as any);

    stream.on('data', (contentPackage) => {
      contentPackages.push(contentPackage);
    });

    stream.on('error', (error) => {
      errors.push(error);
    });

    return { stream, contentPackages, errors };
  }

  async acknowledgeContent(
    deviceId: string,
    deliveryId: string,
    processedSuccessfully: boolean = true,
    errorMessage: string = '',
  ): Promise<any> {
    if (!this.contentClient) {
      throw new Error('Content client not connected');
    }

    return new Promise((resolve, reject) => {
      this.contentClient!.acknowledge(
        {
          device_id: deviceId,
          delivery_id: deliveryId,
          processed_successfully: processedSuccessfully,
          error_message: errorMessage,
        } as any,
        (err, response) => {
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        },
      );
    });
  }
}

// Helper to wait for a specific condition
export function waitFor<T>(
  getter: () => T | undefined,
  timeoutMs: number = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const value = getter();
      if (value !== undefined) {
        clearInterval(interval);
        resolve(value);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for condition'));
      }
    }, 50);
  });
}

// Helper to delay
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
