import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ContentPackage } from 'src/generated/content';

@Injectable()
export class ContentPublisherService implements OnModuleDestroy {
  private readonly subscriptions = new Map<string, Subject<ContentPackage>>();
  private readonly pendingAcks = new Map<string, Set<string>>();

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
    this.pendingAcks.delete(deviceId);
  }

  acknowledge(
    deviceId: string,
    deliveryId: string,
    success: boolean,
    errorMsg?: string,
  ) {
    console.log(
      `✅ Ack from ${deviceId} for ${deliveryId}: ${success ? 'success' : 'failed'}`,
    );

    if (!success && errorMsg) {
      console.error(`   Error: ${errorMsg}`);
    }

    const devicePending = this.pendingAcks.get(deviceId);
    if (devicePending) {
      devicePending.delete(deliveryId);
    }

    return { accepted: true };
  }

  publishToDevice(deviceId: string, contentPackage: ContentPackage) {
    const stream$ = this.subscriptions.get(deviceId);

    if (stream$ && !stream$.closed) {
      stream$.next(contentPackage);
      console.log(`📤 Published ${contentPackage.deliveryId} to ${deviceId}`);

      if (contentPackage.requiresAck) {
        if (!this.pendingAcks.has(deviceId)) {
          this.pendingAcks.set(deviceId, new Set());
        }
        this.pendingAcks.get(deviceId)?.add(contentPackage.deliveryId);
      }
      return true;
    } else {
      console.log(`❌ Device ${deviceId} not connected`);
      return false;
    }
  }

  broadcast(contentPackage: ContentPackage) {
    console.log(`📢 Broadcasting to ${this.subscriptions.size} devices`);
    for (const [deviceId, stream$] of this.subscriptions) {
      if (!stream$.closed) {
        stream$.next(contentPackage);
      }
    }
  }

  getConnectedCount(): number {
    return this.subscriptions.size;
  }

  onModuleDestroy() {
    // Cleanup all subscriptions on shutdown
    for (const [deviceId, stream$] of this.subscriptions) {
      stream$.complete();
    }
    this.subscriptions.clear();
  }
}
