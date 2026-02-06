// File: src/fleet/fleet.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { CommandPublisherService, AckResult } from '../command/command-publisher.service';
import { ContentPublisherService } from '../content/content-publisher.service';
import type { CommandPackage } from '../generated/command/v1/command';
import type { ContentPackage } from '../generated/content/v1/content';
import type {
  Fleet,
  FleetMember,
  FleetBroadcastResult,
  CreateFleetDto,
  UpdateFleetDto,
} from './interfaces/fleet.types';
import { CommandMapper } from '../command/interfaces/command.mapper';

export interface FleetCommandResult extends FleetBroadcastResult {
  ackResults: AckResult[];
}

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name);
  private readonly fleets = new Map<string, Fleet>();
  private readonly deviceToFleets = new Map<string, Set<string>>(); // Reverse index

  constructor(
    private readonly commandPublisher: CommandPublisherService,
    private readonly contentPublisher: ContentPublisherService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Fleet Management
  // ─────────────────────────────────────────────────────────────

  createFleet(dto: CreateFleetDto): Fleet {
    const id = `fleet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const fleet: Fleet = {
      id,
      name: dto.name,
      description: dto.description,
      members: new Map(),
      metadata: dto.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    // Add initial members if provided
    if (dto.deviceIds) {
      for (const deviceId of dto.deviceIds) {
        this.addDeviceToFleetInternal(fleet, deviceId);
      }
    }

    this.fleets.set(id, fleet);
    this.logger.log(
      `Created fleet "${dto.name}" (${id}) with ${fleet.members.size} devices`,
    );
    return fleet;
  }

  deleteFleet(fleetId: string): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return false;

    // Clean up reverse index
    for (const deviceId of fleet.members.keys()) {
      const fleets = this.deviceToFleets.get(deviceId);
      if (fleets) {
        fleets.delete(fleetId);
        if (fleets.size === 0) {
          this.deviceToFleets.delete(deviceId);
        }
      }
    }

    this.fleets.delete(fleetId);
    this.logger.log(`Deleted fleet ${fleetId}`);
    return true;
  }

  updateFleet(fleetId: string, dto: UpdateFleetDto): Fleet | null {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return null;

    if (dto.name !== undefined) fleet.name = dto.name;
    if (dto.description !== undefined) fleet.description = dto.description;
    if (dto.metadata !== undefined)
      fleet.metadata = { ...fleet.metadata, ...dto.metadata };
    fleet.updatedAt = new Date();

    return fleet;
  }

  getFleet(fleetId: string): Fleet | undefined {
    return this.fleets.get(fleetId);
  }

  getAllFleets(): Fleet[] {
    return Array.from(this.fleets.values());
  }

  getFleetsForDevice(deviceId: string): Fleet[] {
    const fleetIds = this.deviceToFleets.get(deviceId);
    if (!fleetIds) return [];
    return Array.from(fleetIds)
      .map((id) => this.fleets.get(id))
      .filter(Boolean) as Fleet[];
  }

  // ─────────────────────────────────────────────────────────────
  // Device Membership
  // ─────────────────────────────────────────────────────────────

  addDeviceToFleet(
    fleetId: string,
    deviceId: string,
    metadata?: Record<string, any>,
  ): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return false;

    this.addDeviceToFleetInternal(fleet, deviceId, metadata);
    fleet.updatedAt = new Date();
    return true;
  }

  removeDeviceFromFleet(fleetId: string, deviceId: string): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return false;

    if (!fleet.members.has(deviceId)) return false;

    fleet.members.delete(deviceId);

    // Update reverse index
    const fleets = this.deviceToFleets.get(deviceId);
    if (fleets) {
      fleets.delete(fleetId);
      if (fleets.size === 0) {
        this.deviceToFleets.delete(deviceId);
      }
    }

    fleet.updatedAt = new Date();
    this.logger.log(`Removed device ${deviceId} from fleet ${fleetId}`);
    return true;
  }

  getFleetMembers(fleetId: string): FleetMember[] {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return [];
    return Array.from(fleet.members.values());
  }

  getDeviceMemberships(deviceId: string): string[] {
    return Array.from(this.deviceToFleets.get(deviceId) || []);
  }

  // ─────────────────────────────────────────────────────────────
  // Broadcast Operations
  // ─────────────────────────────────────────────────────────────

  async broadcastCommand(
    fleetId: string,
    commandBuilder: (deviceId: string) => CommandPackage,
    timeoutMs: number = 5000,
  ): Promise<FleetCommandResult> {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) {
      throw new Error(`Fleet ${fleetId} not found`);
    }

    const members = Array.from(fleet.members.keys());
    const result: FleetCommandResult = {
      fleetId,
      targetDevices: members.length,
      successful: 0,
      failed: 0,
      failures: [],
      ackResults: [],
    };

    this.logger.log(
      `Broadcasting command to fleet ${fleetId} (${members.length} devices)`,
    );

    for (const deviceId of members) {
      try {
        const command = commandBuilder(deviceId);
        const ackResult = await this.commandPublisher.sendCommand(
          deviceId,
          command,
          timeoutMs,
        );

        result.ackResults.push(ackResult);

        if (ackResult.success) {
          result.successful++;
        } else {
          result.failed++;
          result.failures.push({
            deviceId,
            reason: ackResult.errorMessage || 'Command failed',
          });
        }
      } catch (error) {
        result.failed++;
        result.failures.push({ deviceId, reason: error.message });
        result.ackResults.push({
          success: false,
          commandId: '',
          deviceId,
          errorMessage: error.message,
          timedOut: false,
        });
      }
    }

    this.logger.log(
      `Fleet broadcast complete: ${result.successful}/${result.targetDevices} successful`,
    );
    return result;
  }

  async broadcastContent(
    fleetId: string,
    contentPackage: ContentPackage,
    timeoutMs: number = 5000,
  ): Promise<FleetBroadcastResult> {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) {
      throw new Error(`Fleet ${fleetId} not found`);
    }

    const members = Array.from(fleet.members.keys());
    const result: FleetBroadcastResult = {
      fleetId,
      targetDevices: members.length,
      successful: 0,
      failed: 0,
      failures: [],
    };

    this.logger.log(
      `Broadcasting content to fleet ${fleetId} (${members.length} devices)`,
    );

    for (const deviceId of members) {
      try {
        const ackResult = await this.contentPublisher.publishToDevice(
          deviceId,
          contentPackage,
          timeoutMs,
        );

        if (ackResult.success) {
          result.successful++;
        } else {
          result.failed++;
          result.failures.push({
            deviceId,
            reason: ackResult.errorMessage || 'Content delivery failed',
          });
        }
      } catch (error) {
        result.failed++;
        result.failures.push({ deviceId, reason: error.message });
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // Utility Broadcast Methods
  // ─────────────────────────────────────────────────────────────

  async rotateScreenFleet(
    fleetId: string,
    orientation: string,
    fullscreen?: boolean,
    timeoutMs: number = 5000,
  ): Promise<FleetCommandResult> {
    return this.broadcastCommand(
      fleetId,
      (deviceId) =>
        CommandMapper.toCommandPackage({
          command_id: `rotate-fleet-${fleetId}-${Date.now()}`,
          requires_ack: true,
          issued_at: new Date().toISOString(),
          rotate_screen: {
            orientation,
            fullscreen: fullscreen ?? null,
          },
        }),
      timeoutMs,
    );
  }

  async rebootFleet(
    fleetId: string,
    delaySeconds: number = 0,
    timeoutMs: number = 5000,
  ): Promise<FleetCommandResult> {
    return this.broadcastCommand(
      fleetId,
      (deviceId) =>
        CommandMapper.toCommandPackage({
          command_id: `reboot-fleet-${fleetId}-${Date.now()}`,
          requires_ack: true,
          issued_at: new Date().toISOString(),
          request_reboot: { delay_seconds: delaySeconds },
        }),
      timeoutMs,
    );
  }

  async updateNetworkFleet(
    fleetId: string,
    newSsid: string,
    newPassword: string,
    timeoutMs: number = 5000,
  ): Promise<FleetCommandResult> {
    return this.broadcastCommand(
      fleetId,
      (deviceId) =>
        CommandMapper.toCommandPackage({
          command_id: `network-fleet-${fleetId}-${Date.now()}`,
          requires_ack: true,
          issued_at: new Date().toISOString(),
          update_network: { new_ssid: newSsid, new_password: newPassword },
        }),
      timeoutMs,
    );
  }

  async setClockFleet(
    fleetId: string,
    simulatedTime: string,
    timeoutMs: number = 5000,
  ): Promise<FleetCommandResult> {
    return this.broadcastCommand(
      fleetId,
      (deviceId) =>
        CommandMapper.toCommandPackage({
          command_id: `clock-fleet-${fleetId}-${Date.now()}`,
          requires_ack: true,
          issued_at: new Date().toISOString(),
          set_clock: { simulated_time: simulatedTime },
        }),
      timeoutMs,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  private addDeviceToFleetInternal(
    fleet: Fleet,
    deviceId: string,
    metadata?: Record<string, any>,
  ): void {
    fleet.members.set(deviceId, {
      deviceId,
      joinedAt: new Date(),
      metadata,
    });

    // Update reverse index
    if (!this.deviceToFleets.has(deviceId)) {
      this.deviceToFleets.set(deviceId, new Set());
    }
    this.deviceToFleets.get(deviceId)!.add(fleet.id);
  }
}
