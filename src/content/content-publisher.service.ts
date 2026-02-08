import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Subject } from "rxjs";
import type { ContentPackage } from "src/generated/content/v1/content";
import { AcknowledgeStatus, type ContentProgress } from "src/generated/content/v1/content";

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
   */
  acknowledge(
    deviceId: string,
    deliveryId: string,
    status: AcknowledgeStatus,
    message?: string,
    progress?: ContentProgress,
  ) {
    // Map status to success boolean
    const success = status === AcknowledgeStatus.ACKNOWLEDGE_STATUS_COMPLETED;

    console.log(
      `✅ Ack from ${deviceId} for ${deliveryId}: ${success ? "success" : "failed"} (status: ${status})`,
    );

    if (!success && message) {
      console.error(`   Error: ${message}`);
    }

    if (progress) {
      console.log(
        `   Progress: ${progress.percentComplete}% (${progress.completedMediaCount}/${progress.totalMediaCount})`,
      );
    }

    // Resolve pending ACK if exists
    const devicePending = this.pendingAcks.get(deviceId);
    if (devicePending) {
      const pending = devicePending.get(deliveryId);
      if (pending) {
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

    return { accepted: true };
  }

  async publishToDevice(
    deviceId: string,
    contentPackage: ContentPackage,
    timeoutMs: number = 5000,
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

  async broadcast(
    contentPackage: ContentPackage,
    timeoutMs: number = 5000,
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
