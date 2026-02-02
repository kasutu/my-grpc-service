import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { CommandPackage } from 'src/generated/command/v1/command';

@Injectable()
export class CommandPublisherService implements OnModuleDestroy {
  private readonly subscriptions = new Map<string, Subject<CommandPackage>>();
  private readonly pendingAcks = new Map<string, Set<string>>();

  subscribe(deviceId: string): Subject<CommandPackage> {
    if (this.subscriptions.has(deviceId)) {
      console.log(
        `⚠️ Device ${deviceId} already subscribed to commands, replacing`,
      );
      this.subscriptions.get(deviceId)?.complete();
    }

    const stream$ = new Subject<CommandPackage>();
    this.subscriptions.set(deviceId, stream$);

    console.log(
      `🎮 Device ${deviceId} subscribed to commands (total: ${this.subscriptions.size})`,
    );
    return stream$;
  }

  unsubscribe(deviceId: string) {
    console.log(`👋 Device ${deviceId} unsubscribed from commands`);
    this.subscriptions.delete(deviceId);
    this.pendingAcks.delete(deviceId);
  }

  acknowledge(
    deviceId: string,
    commandId: string,
    success: boolean,
    errorMsg?: string,
  ) {
    console.log(
      `✅ Command ack from ${deviceId} for ${commandId}: ${success ? 'success' : 'failed'}`,
    );
    if (!success && errorMsg) {
      console.error(`   Error: ${errorMsg}`);
    }

    const devicePending = this.pendingAcks.get(deviceId);
    if (devicePending) {
      devicePending.delete(commandId);
    }
    return { accepted: true };
  }

  sendCommand(deviceId: string, commandPackage: CommandPackage) {
    const stream$ = this.subscriptions.get(deviceId);

    if (stream$ && !stream$.closed) {
      stream$.next(commandPackage);
      console.log(`📤 Sent command ${commandPackage.commandId} to ${deviceId}`);

      if (commandPackage.requiresAck) {
        if (!this.pendingAcks.has(deviceId)) {
          this.pendingAcks.set(deviceId, new Set());
        }
        this.pendingAcks.get(deviceId)?.add(commandPackage.commandId);
      }
      return true;
    }
    console.log(`❌ Device ${deviceId} not connected for commands`);
    return false;
  }

  broadcastCommand(commandPackage: CommandPackage) {
    console.log(
      `📢 Broadcasting command to ${this.subscriptions.size} devices`,
    );
    for (const [deviceId, stream$] of this.subscriptions) {
      if (!stream$.closed) {
        stream$.next(commandPackage);
      }
    }
  }

  getConnectedCount(): number {
    return this.subscriptions.size;
  }

  onModuleDestroy() {
    for (const [, stream$] of this.subscriptions) {
      stream$.complete();
    }
    this.subscriptions.clear();
  }
}
