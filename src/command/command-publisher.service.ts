import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Subject, firstValueFrom, race, timer } from "rxjs";
import { map, take } from "rxjs/operators";
import type { CommandPackage } from "src/generated/command/v1/command";
import { AcknowledgeStatus } from "src/generated/command/v1/command";

export interface AckResult {
  success: boolean;
  commandId: string;
  deviceId: string;
  errorMessage?: string;
  timedOut?: boolean;
}

interface DeviceInfo {
  deviceId: string;
  connectedAt: Date;
  lastActivity: Date;
}

interface PendingAck {
  commandId: string;
  deviceId: string;
  resolve: (result: AckResult) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
}

@Injectable()
export class CommandPublisherService implements OnModuleDestroy {
  private readonly subscriptions = new Map<string, Subject<CommandPackage>>();
  private readonly deviceInfo = new Map<string, DeviceInfo>();
  private readonly pendingAcks = new Map<string, Map<string, PendingAck>>();

  subscribe(deviceId: string): Subject<CommandPackage> {
    if (this.subscriptions.has(deviceId)) {
      console.log(
        `⚠️ Device ${deviceId} already subscribed to commands, replacing`,
      );
      this.subscriptions.get(deviceId)?.complete();
    }

    const stream$ = new Subject<CommandPackage>();
    this.subscriptions.set(deviceId, stream$);

    // Track device info
    const now = new Date();
    this.deviceInfo.set(deviceId, {
      deviceId,
      connectedAt: now,
      lastActivity: now,
    });

    console.log(
      `🎮 Device ${deviceId} subscribed to commands (total: ${this.subscriptions.size})`,
    );
    return stream$;
  }

  unsubscribe(deviceId: string) {
    console.log(`👋 Device ${deviceId} unsubscribed from commands`);
    this.subscriptions.delete(deviceId);
    this.deviceInfo.delete(deviceId);

    // Reject all pending ACKs for this device
    const devicePending = this.pendingAcks.get(deviceId);
    if (devicePending) {
      for (const pending of devicePending.values()) {
        pending.resolve({
          success: false,
          commandId: pending.commandId,
          deviceId,
          errorMessage: "Device disconnected",
          timedOut: false,
        });
      }
      this.pendingAcks.delete(deviceId);
    }
  }

  /**
   * Handle command acknowledgment from device
   * Only resolves pending ACKs for final statuses (COMPLETED, FAILED, REJECTED)
   * RECEIVED status is logged but doesn't resolve (command still executing)
   */
  acknowledge(
    deviceId: string,
    commandId: string,
    status: AcknowledgeStatus,
    message?: string,
  ) {
    // Check if this is a final status
    const finalStatuses = [
      AcknowledgeStatus.ACKNOWLEDGE_STATUS_COMPLETED,
      AcknowledgeStatus.ACKNOWLEDGE_STATUS_FAILED,
      AcknowledgeStatus.ACKNOWLEDGE_STATUS_REJECTED,
    ];
    const isFinal = finalStatuses.includes(status);

    // Map status enum to boolean success
    const success = status === AcknowledgeStatus.ACKNOWLEDGE_STATUS_COMPLETED;

    if (isFinal) {
      console.log(
        `✅ Final command ack from ${deviceId} for ${commandId}: ${success ? "success" : "failed"} (status: ${status})`,
      );
    } else {
      console.log(
        `⏳ Command received from ${deviceId} for ${commandId}: ${AcknowledgeStatus[status]} (executing...)`,
      );
    }

    if (message) {
      console.log(`   Message: ${message}`);
    }

    // Update last activity
    const info = this.deviceInfo.get(deviceId);
    if (info) {
      info.lastActivity = new Date();
    }

    // Only resolve pending ACK for final statuses
    if (isFinal) {
      const devicePending = this.pendingAcks.get(deviceId);
      if (devicePending) {
        const pending = devicePending.get(commandId);
        if (pending) {
          pending.resolve({
            success,
            commandId,
            deviceId,
            errorMessage: message,
            timedOut: false,
          });
          devicePending.delete(commandId);
          if (devicePending.size === 0) {
            this.pendingAcks.delete(deviceId);
          }
        }
      }
    }

    return { accepted: true };
  }

  async sendCommand(
    deviceId: string,
    commandPackage: CommandPackage,
    timeoutMs: number = 60000,
  ): Promise<AckResult> {
    const stream$ = this.subscriptions.get(deviceId);

    if (!stream$ || stream$.closed) {
      console.log(`❌ Device ${deviceId} not connected for commands`);
      return {
        success: false,
        commandId: commandPackage.commandId,
        deviceId,
        errorMessage: "Device not connected",
        timedOut: false,
      };
    }

    // Send the command
    stream$.next(commandPackage);
    console.log(`📤 Sent command ${commandPackage.commandId} to ${deviceId}`);

    // Update last activity
    const info = this.deviceInfo.get(deviceId);
    if (info) {
      info.lastActivity = new Date();
    }

    // If no ACK required, return immediately as success
    if (!commandPackage.requiresAck) {
      return {
        success: true,
        commandId: commandPackage.commandId,
        deviceId,
        timedOut: false,
      };
    }

    // Wait for ACK with timeout
    return this.waitForAck(deviceId, commandPackage.commandId, timeoutMs);
  }

  private waitForAck(
    deviceId: string,
    commandId: string,
    timeoutMs: number,
  ): Promise<AckResult> {
    return new Promise<AckResult>((resolve, reject) => {
      // Create pending ACK entry
      if (!this.pendingAcks.has(deviceId)) {
        this.pendingAcks.set(deviceId, new Map());
      }
      const devicePending = this.pendingAcks.get(deviceId)!;

      const pending: PendingAck = {
        commandId,
        deviceId,
        resolve,
        reject,
        timeoutMs,
      };

      devicePending.set(commandId, pending);

      // Set up timeout
      setTimeout(() => {
        const stillPending = devicePending.get(commandId);
        if (stillPending) {
          devicePending.delete(commandId);
          if (devicePending.size === 0) {
            this.pendingAcks.delete(deviceId);
          }
          resolve({
            success: false,
            commandId,
            deviceId,
            errorMessage: `ACK timeout after ${timeoutMs}ms`,
            timedOut: true,
          });
        }
      }, timeoutMs);
    });
  }

  async broadcastCommand(
    commandPackage: CommandPackage,
    timeoutMs: number = 60000,
  ): Promise<AckResult[]> {
    console.log(
      `📢 Broadcasting command to ${this.subscriptions.size} devices`,
    );
    const promises: Promise<AckResult>[] = [];

    for (const [deviceId, stream$] of this.subscriptions) {
      if (!stream$.closed) {
        const promise = this.sendCommand(deviceId, commandPackage, timeoutMs);
        promises.push(promise);

        const info = this.deviceInfo.get(deviceId);
        if (info) {
          info.lastActivity = new Date();
        }
      }
    }

    return Promise.all(promises);
  }

  getConnectedCount(): number {
    return this.subscriptions.size;
  }

  // NEW: Get list of connected devices
  getConnectedDevices(): DeviceInfo[] {
    return Array.from(this.deviceInfo.values());
  }

  onModuleDestroy() {
    // Reject all pending ACKs
    for (const [deviceId, devicePending] of this.pendingAcks) {
      for (const pending of devicePending.values()) {
        pending.resolve({
          success: false,
          commandId: pending.commandId,
          deviceId,
          errorMessage: "Service shutting down",
          timedOut: false,
        });
      }
    }
    this.pendingAcks.clear();

    for (const [, stream$] of this.subscriptions) {
      stream$.complete();
    }
    this.subscriptions.clear();
    this.deviceInfo.clear();
  }
}
