import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { join } from "path";

// New v2 analytics client interface
export interface GrpcAnalyticsClient {
  ingest(
    request: {
      batch_id: Buffer;
      events: Array<{
        event_id: Buffer;
        timestamp_ms: number;
        type: string; // 'ERROR' | 'IMPRESSION' | 'HEARTBEAT' | 'PERFORMANCE' | 'LIFECYCLE'
        schema_version: number;
        payload: Buffer; // CBOR encoded
        network?: {
          quality: string; // 'OFFLINE' | 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT'
          download_mbps?: number;
          upload_mbps?: number;
          connection_type?: string;
          signal_strength_dbm?: number;
        };
      }>;
      device_fingerprint: number;
      queue?: {
        pending_events?: number;
        oldest_event_age_hours?: number;
        is_backpressure?: boolean;
      };
      sent_at_ms: number;
    },
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
}

export interface GrpcCommandClient {
  subscribeCommands(request: {
    deviceId: string;
  }): grpc.ClientReadableStream<any>;
  acknowledge(
    request: {
      deviceId: string;
      commandId: string;
      status: string;
      message?: string;
    },
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
}

export interface GrpcContentClient {
  subscribe(request: {
    deviceId: string;
    lastReceivedDeliveryId?: string;
  }): grpc.ClientReadableStream<any>;
  acknowledge(
    request: {
      deviceId: string;
      deliveryId: string;
      status: string;
      message?: string;
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
    const srcDir = join(__dirname, "../../src");

    // Load command proto - package is remote.v1
    const commandPackageDefinition = protoLoader.loadSync(
      join(srcDir, "command/v1/command.proto"),
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
      join(srcDir, "content/v1/content.proto"),
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
      join(srcDir, "analytics/v1/analytics.proto"),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    );
    this.analyticsProto = grpc.loadPackageDefinition(
      analyticsPackageDefinition,
    );
  }

  connect(): void {
    const address = `localhost:${this.grpcPort}`;

    // Create command client - package command.v1
    const CommandService =
      this.commandProto.command.v1.CommandService;
    this.commandClient = new CommandService(
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
      throw new Error("Command client not connected");
    }

    const commands: any[] = [];
    const errors: any[] = [];
    // Use snake_case to match proto field names (protoLoader with keepCase: true)
    const stream = this.commandClient.subscribeCommands({
      device_id: deviceId,
    } as any);

    stream.on("data", (command) => {
      commands.push(command);
    });

    stream.on("error", (error) => {
      errors.push(error);
    });

    return { stream, commands, errors };
  }

  async acknowledgeCommand(
    deviceId: string,
    commandId: string,
    status: string = "ACKNOWLEDGE_STATUS_COMPLETED",
    message: string = "",
  ): Promise<any> {
    if (!this.commandClient) {
      throw new Error("Command client not connected");
    }

    return new Promise((resolve, reject) => {
      this.commandClient!.acknowledge(
        {
          device_id: deviceId,
          command_id: commandId,
          status: status,
          message: message,
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
      throw new Error("Content client not connected");
    }

    const contentPackages: any[] = [];
    const errors: any[] = [];
    // Use snake_case to match proto field names (protoLoader with keepCase: true)
    const stream = this.contentClient.subscribe({
      device_id: deviceId,
      last_received_delivery_id: lastReceivedDeliveryId || "",
    } as any);

    stream.on("data", (contentPackage) => {
      contentPackages.push(contentPackage);
    });

    stream.on("error", (error) => {
      errors.push(error);
    });

    return { stream, contentPackages, errors };
  }

  async acknowledgeContent(
    deviceId: string,
    deliveryId: string,
    status: string = "ACKNOWLEDGE_STATUS_COMPLETED",
    message: string = "",
    progress?: {
      percentComplete: number;
      totalMediaCount: number;
      completedMediaCount: number;
      failedMediaCount: number;
      mediaStatus?: Array<{
        mediaId: string;
        state: string;
        errorCode?: string;
        errorMessage?: string;
      }>;
    },
  ): Promise<any> {
    if (!this.contentClient) {
      throw new Error("Content client not connected");
    }

    const request: any = {
      device_id: deviceId,
      delivery_id: deliveryId,
      status: status,
      message: message,
    };

    if (progress) {
      request.progress = {
        percent_complete: progress.percentComplete,
        total_media_count: progress.totalMediaCount,
        completed_media_count: progress.completedMediaCount,
        failed_media_count: progress.failedMediaCount,
        media_status: progress.mediaStatus?.map((m) => ({
          media_id: m.mediaId,
          state: m.state,
          error_code: m.errorCode || "",
          error_message: m.errorMessage || "",
        })),
      };
    }

    return new Promise((resolve, reject) => {
      this.contentClient!.acknowledge(request, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  // New v2 analytics ingest method
  async ingest(
    batchRequest: Parameters<GrpcAnalyticsClient["ingest"]>[0],
  ): Promise<any> {
    if (!this.analyticsClient) {
      throw new Error("Analytics client not connected");
    }

    return new Promise((resolve, reject) => {
      this.analyticsClient!.ingest(batchRequest as any, (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Legacy method removed - analytics v2 uses 'ingest' instead of 'uploadBatch'
}

// Re-export helpers for backward compatibility
export { delay, waitFor } from "../helpers/async";
