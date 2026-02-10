import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import type { ContentPackage } from "src/generated/content/v1/content";
import { AcknowledgeStatus, type ContentProgress } from "src/generated/content/v1/content";

export interface ProgressUpdate {
  /** Indicates if this is a final (terminal) update */
  isFinal: boolean;
  /** Current status of the operation */
  status: AcknowledgeStatus;
  /** Whether the operation was successful (only valid when isFinal=true) */
  success?: boolean;
  deliveryId: string;
  deviceId: string;
  errorMessage?: string;
  /** Progress details for IN_PROGRESS updates */
  progress?: ContentProgress;
  /** Whether this update represents a timeout */
  timedOut?: boolean;
}

export interface AckResult {
  success: boolean;
  deliveryId: string;
  deviceId: string;
  errorMessage?: string;
  timedOut?: boolean;
}

interface PendingAck {
  deliveryId: string;
  deviceId: string;
  resolve: (result: AckResult) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
  /** Callback for progress updates */
  onProgress?: (update: ProgressUpdate) => void;
}

@Injectable()
export class ContentPublisherService implements OnModuleDestroy {
  private readonly subscriptions = new Map<string, Subject<ContentPackage>>();
  private readonly pendingAcks = new Map<string, Map<string, PendingAck>>();

  subscribe(
    deviceId: string,
    lastDeliveryId?: string,
  ): Subject<ContentPackage> {
    // Cleanup existing subscription if present
    if (this.subscriptions.has(deviceId)) {
      console.log(
        `⚠️ Device ${deviceId} already subscribed, replacing connection`,
      );
      this.subscriptions.get(deviceId)?.complete();
    }

    const stream$ = new Subject<ContentPackage>();
    this.subscriptions.set(deviceId, stream$);

    console.log(
      `📱 Device ${deviceId} subscribed (total: ${this.subscriptions.size})`,
    );

    // Handle resume logic here if needed
    if (lastDeliveryId) {
      console.log(`🔄 Resuming from delivery ${lastDeliveryId}`);
    }

    return stream$;
  }

  unsubscribe(deviceId: string) {
    console.log(`👋 Device ${deviceId} unsubscribed`);
    this.subscriptions.delete(deviceId);

    // Reject all pending ACKs for this device
    const devicePending = this.pendingAcks.get(deviceId);
    if (devicePending) {
      for (const pending of devicePending.values()) {
        pending.resolve({
          success: false,
          deliveryId: pending.deliveryId,
          deviceId,
          errorMessage: "Device disconnected",
          timedOut: false,
        });
      }
      this.pendingAcks.delete(deviceId);
    }
  }

  /**
   * Handle acknowledgment from device
   * Only resolves pending ACKs for final statuses (COMPLETED, PARTIAL, FAILED)
   * Intermediate statuses (RECEIVED, IN_PROGRESS) are logged but don't resolve
   */
  acknowledge(
    deviceId: string,
    deliveryId: string,
    status: AcknowledgeStatus,
    message?: string,
    progress?: ContentProgress,
  ) {
    // Check if this is a final status
    const finalStatuses = [
      AcknowledgeStatus.ACKNOWLEDGE_STATUS_COMPLETED,
      AcknowledgeStatus.ACKNOWLEDGE_STATUS_PARTIAL,
      AcknowledgeStatus.ACKNOWLEDGE_STATUS_FAILED,
    ];
    const isFinal = finalStatuses.includes(status);

    // Map status to success boolean (only COMPLETED is full success)
    const success = status === AcknowledgeStatus.ACKNOWLEDGE_STATUS_COMPLETED;

    if (isFinal) {
      console.log(
        `✅ Final ack from ${deviceId} for ${deliveryId}: ${success ? "success" : "failed"} (status: ${status})`,
      );
    } else {
      console.log(
        `⏳ Progress from ${deviceId} for ${deliveryId}: ${AcknowledgeStatus[status]} (status: ${status})`,
      );
    }

    if (message) {
      console.log(`   Message: ${message}`);
    }

    if (progress) {
      console.log(
        `   Progress: ${progress.percentComplete}% (${progress.completedMediaCount}/${progress.totalMediaCount})`,
      );
    }

    const devicePending = this.pendingAcks.get(deviceId);
    if (devicePending) {
      const pending = devicePending.get(deliveryId);
      if (pending) {
        // Emit progress update if callback is registered
        if (pending.onProgress) {
          pending.onProgress({
            isFinal,
            status,
            success: isFinal ? success : undefined,
            deliveryId,
            deviceId,
            errorMessage: message,
            progress,
            timedOut: false,
          });
        }

        // Only resolve pending ACK for final statuses
        if (isFinal) {
          pending.resolve({
            success,
            deliveryId,
            deviceId,
            errorMessage: message,
            timedOut: false,
          });
          devicePending.delete(deliveryId);
          if (devicePending.size === 0) {
            this.pendingAcks.delete(deviceId);
          }
        }
      }
    }

    return { accepted: true };
  }

  async publishToDevice(
    deviceId: string,
    contentPackage: ContentPackage,
    timeoutMs: number = 60000,
  ): Promise<AckResult> {
    const stream$ = this.subscriptions.get(deviceId);

    if (!stream$ || stream$.closed) {
      console.log(`❌ Device ${deviceId} not connected`);
      return {
        success: false,
        deliveryId: contentPackage.deliveryId,
        deviceId,
        errorMessage: "Device not connected",
        timedOut: false,
      };
    }

    // Send the content
    stream$.next(contentPackage);
    console.log(`📤 Published ${contentPackage.deliveryId} to ${deviceId}`);

    // If no ACK required, return immediately as success
    if (!contentPackage.requiresAck) {
      return {
        success: true,
        deliveryId: contentPackage.deliveryId,
        deviceId,
        timedOut: false,
      };
    }

    // Wait for ACK with timeout
    return this.waitForAck(deviceId, contentPackage.deliveryId, timeoutMs);
  }

  /**
   * Publish content to a device with streaming progress updates
   * Returns an Observable that emits progress updates until completion
   */
  publishToDeviceStream(
    deviceId: string,
    contentPackage: ContentPackage,
    timeoutMs: number = 60000,
  ): Observable<ProgressUpdate> {
    const stream$ = this.subscriptions.get(deviceId);

    if (!stream$ || stream$.closed) {
      console.log(`❌ Device ${deviceId} not connected`);
      return new Observable<ProgressUpdate>((subscriber) => {
        subscriber.next({
          isFinal: true,
          status: AcknowledgeStatus.ACKNOWLEDGE_STATUS_FAILED,
          success: false,
          deliveryId: contentPackage.deliveryId,
          deviceId,
          errorMessage: "Device not connected",
          timedOut: false,
        });
        subscriber.complete();
      });
    }

    // Send the content
    stream$.next(contentPackage);
    console.log(`📤 Published ${contentPackage.deliveryId} to ${deviceId} (streaming)`);

    // If no ACK required, return immediately as success
    if (!contentPackage.requiresAck) {
      return new Observable<ProgressUpdate>((subscriber) => {
        subscriber.next({
          isFinal: true,
          status: AcknowledgeStatus.ACKNOWLEDGE_STATUS_COMPLETED,
          success: true,
          deliveryId: contentPackage.deliveryId,
          deviceId,
          timedOut: false,
        });
        subscriber.complete();
      });
    }

    // Return observable that streams progress updates
    return new Observable<ProgressUpdate>((subscriber) => {
      const onProgress = (update: ProgressUpdate) => {
        subscriber.next(update);
        if (update.isFinal) {
          subscriber.complete();
        }
      };

      this.waitForAckWithProgress(
        deviceId,
        contentPackage.deliveryId,
        timeoutMs,
        onProgress,
      );

      // Cleanup on unsubscribe
      return () => {
        // Pending ack will be cleaned up by timeout
      };
    });
  }

  private waitForAck(
    deviceId: string,
    deliveryId: string,
    timeoutMs: number,
  ): Promise<AckResult> {
    return new Promise<AckResult>((resolve, reject) => {
      // Create pending ACK entry
      if (!this.pendingAcks.has(deviceId)) {
        this.pendingAcks.set(deviceId, new Map());
      }
      const devicePending = this.pendingAcks.get(deviceId)!;

      const pending: PendingAck = {
        deliveryId,
        deviceId,
        resolve,
        reject,
        timeoutMs,
      };

      devicePending.set(deliveryId, pending);

      // Set up timeout
      setTimeout(() => {
        const stillPending = devicePending.get(deliveryId);
        if (stillPending) {
          devicePending.delete(deliveryId);
          if (devicePending.size === 0) {
            this.pendingAcks.delete(deviceId);
          }
          resolve({
            success: false,
            deliveryId,
            deviceId,
            errorMessage: `ACK timeout after ${timeoutMs}ms`,
            timedOut: true,
          });
        }
      }, timeoutMs);
    });
  }

  private waitForAckWithProgress(
    deviceId: string,
    deliveryId: string,
    timeoutMs: number,
    onProgress: (update: ProgressUpdate) => void,
  ): void {
    // Create pending ACK entry
    if (!this.pendingAcks.has(deviceId)) {
      this.pendingAcks.set(deviceId, new Map());
    }
    const devicePending = this.pendingAcks.get(deviceId)!;

    const pending: PendingAck = {
      deliveryId,
      deviceId,
      resolve: (result: AckResult) => {
        // Resolve is called, progress callback already handled final state
      },
      reject: (error: Error) => {
        onProgress({
          isFinal: true,
          status: AcknowledgeStatus.ACKNOWLEDGE_STATUS_FAILED,
          success: false,
          deliveryId,
          deviceId,
          errorMessage: error.message,
          timedOut: false,
        });
      },
      timeoutMs,
      onProgress,
    };

    devicePending.set(deliveryId, pending);

    // Set up timeout
    setTimeout(() => {
      const stillPending = devicePending.get(deliveryId);
      if (stillPending) {
        devicePending.delete(deliveryId);
        if (devicePending.size === 0) {
          this.pendingAcks.delete(deviceId);
        }
        onProgress({
          isFinal: true,
          status: AcknowledgeStatus.ACKNOWLEDGE_STATUS_FAILED,
          success: false,
          deliveryId,
          deviceId,
          errorMessage: `ACK timeout after ${timeoutMs}ms`,
          timedOut: true,
        });
      }
    }, timeoutMs);
  }

  async broadcast(
    contentPackage: ContentPackage,
    timeoutMs: number = 60000,
  ): Promise<AckResult[]> {
    console.log(`📢 Broadcasting to ${this.subscriptions.size} devices`);
    const promises: Promise<AckResult>[] = [];

    for (const [deviceId, stream$] of this.subscriptions) {
      if (!stream$.closed) {
        const promise = this.publishToDevice(
          deviceId,
          contentPackage,
          timeoutMs,
        );
        promises.push(promise);
      }
    }

    return Promise.all(promises);
  }

  /**
   * Broadcast content to all connected devices with streaming progress
   * Returns an Observable that emits updates for all devices
   */
  broadcastStream(
    contentPackage: ContentPackage,
    timeoutMs: number = 60000,
  ): Observable<
    | (ProgressUpdate & { totalDevices: number; completedDevices: number })
    | { type: "started"; totalDevices: number; deliveryId: string }
    | { type: "complete"; totalDevices: number; successful: number; failed: number }
  > {
    return new Observable((subscriber) => {
      const devices = Array.from(this.subscriptions.entries()).filter(
        ([, stream$]) => !stream$.closed,
      );
      const totalDevices = devices.length;
      let completedDevices = 0;
      let successfulCount = 0;
      let failedCount = 0;

      // Emit started event immediately
      subscriber.next({
        type: "started" as const,
        totalDevices,
        deliveryId: contentPackage.deliveryId,
      });

      if (totalDevices === 0) {
        subscriber.next({
          type: "complete" as const,
          totalDevices: 0,
          successful: 0,
          failed: 0,
        });
        subscriber.complete();
        return;
      }

      console.log(`📢 Broadcasting to ${totalDevices} devices (streaming)`);

      const subscriptions: { deviceId: string; unsubscribe: () => void }[] = [];

      for (const [deviceId] of devices) {
        const stream = this.publishToDeviceStream(
          deviceId,
          contentPackage,
          timeoutMs,
        );

        const sub = stream.subscribe({
          next: (update) => {
            subscriber.next({
              ...update,
              totalDevices,
              completedDevices,
            });
            if (update.isFinal) {
              completedDevices++;
              if (update.success) {
                successfulCount++;
              } else {
                failedCount++;
              }
            }
          },
          complete: () => {
            if (completedDevices >= totalDevices) {
              subscriber.next({
                type: "complete" as const,
                totalDevices,
                successful: successfulCount,
                failed: failedCount,
              });
              subscriber.complete();
            }
          },
        });

        subscriptions.push({
          deviceId,
          unsubscribe: () => sub.unsubscribe(),
        });
      }

      // Cleanup on unsubscribe
      return () => {
        for (const { unsubscribe } of subscriptions) {
          unsubscribe();
        }
      };
    });
  }

  getConnectedCount(): number {
    return this.subscriptions.size;
  }

  onModuleDestroy() {
    // Reject all pending ACKs
    for (const [deviceId, devicePending] of this.pendingAcks) {
      for (const pending of devicePending.values()) {
        pending.resolve({
          success: false,
          deliveryId: pending.deliveryId,
          deviceId,
          errorMessage: "Service shutting down",
          timedOut: false,
        });
      }
    }
    this.pendingAcks.clear();

    // Cleanup all subscriptions on shutdown
    for (const [deviceId, stream$] of this.subscriptions) {
      stream$.complete();
    }
    this.subscriptions.clear();
  }
}
