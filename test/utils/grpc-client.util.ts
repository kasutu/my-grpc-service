import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

export interface GrpcAnalyticsClient {
  uploadBatch(
    request: {
      device_id: string;
      batch_id: string;
      timestamp_ms: number;
      events: Array<{
        event_id: string;
        timestamp_ms: number;
        category: number;
        playback?: {
          campaign_id: string;
          media_id: string;
          duration_ms: number;
          completed: boolean;
        };
        error?: {
          error_type: string;
          message: string;
          component: string;
          is_fatal: boolean;
        };
        health?: {
          battery_level: number;
          storage_free_bytes: number;
          cpu_usage: number;
          memory_usage: number;
          connection_quality: number;
        };
      }>;
      network_context?: {
        quality: number;
        download_speed_mbps: number;
        latency_ms: number;
      };
      queue_status?: {
        pending_count: number;
        oldest_event_hours: number;
      };
    },
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
}

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
  private analyticsClient: GrpcAnalyticsClient | null = null;
  private commandProto: any;
  private contentProto: any;
  private analyticsProto: any;

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

    // Load analytics proto - package is analytics.v1
    const analyticsPackageDefinition = protoLoader.loadSync(
      join(srcDir, 'analytics/v1/analytics.proto'),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    );
    this.analyticsProto = grpc.loadPackageDefinition(analyticsPackageDefinition);
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

    // Create analytics client - package analytics.v1
    const AnalyticsService = this.analyticsProto.analytics.v1.AnalyticsService;
    this.analyticsClient = new AnalyticsService(
      address,
      grpc.credentials.createInsecure(),
    ) as GrpcAnalyticsClient;
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
    if (this.analyticsClient) {
      (this.analyticsClient as any).close();
      this.analyticsClient = null;
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

  async uploadBatch(batchRequest: Parameters<GrpcAnalyticsClient['uploadBatch']>[0]): Promise<any> {
    if (!this.analyticsClient) {
      throw new Error('Analytics client not connected');
    }

    return new Promise((resolve, reject) => {
      this.analyticsClient!.uploadBatch(batchRequest as any, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }
}

// Re-export helpers for backward compatibility
export { delay, waitFor } from '../helpers/async';
