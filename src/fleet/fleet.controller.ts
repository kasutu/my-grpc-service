// File: src/fleet/fleet.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Patch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FleetService } from './fleet.service';
import { ContentMapper } from '../content/interfaces/content.mapper';
import { CreateFleetDto, UpdateFleetDto } from './interfaces/fleet.types';

@Controller('fleets')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  // ─────────────────────────────────────────────────────────────
  // Fleet CRUD
  // ─────────────────────────────────────────────────────────────

  @Post()
  createFleet(@Body() dto: CreateFleetDto) {
    const fleet = this.fleetService.createFleet(dto);
    return {
      success: true,
      fleet: this.serializeFleet(fleet),
    };
  }

  @Get()
  getAllFleets() {
    const fleets = this.fleetService.getAllFleets();
    return {
      count: fleets.length,
      fleets: fleets.map((f) => this.serializeFleet(f)),
    };
  }

  @Get(':fleetId')
  getFleet(@Param('fleetId') fleetId: string) {
    const fleet = this.fleetService.getFleet(fleetId);
    if (!fleet) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }
    return this.serializeFleet(fleet);
  }

  @Patch(':fleetId')
  updateFleet(@Param('fleetId') fleetId: string, @Body() dto: UpdateFleetDto) {
    const fleet = this.fleetService.updateFleet(fleetId, dto);
    if (!fleet) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      fleet: this.serializeFleet(fleet),
    };
  }

  @Delete(':fleetId')
  deleteFleet(@Param('fleetId') fleetId: string) {
    const success = this.fleetService.deleteFleet(fleetId);
    if (!success) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }
    return { success: true, message: `Fleet ${fleetId} deleted` };
  }

  // ─────────────────────────────────────────────────────────────
  // Fleet Membership
  // ─────────────────────────────────────────────────────────────

  @Post(':fleetId/devices/:deviceId')
  addDevice(
    @Param('fleetId') fleetId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: { metadata?: Record<string, any> },
  ) {
    const success = this.fleetService.addDeviceToFleet(
      fleetId,
      deviceId,
      body?.metadata,
    );
    if (!success) {
      throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      message: `Device ${deviceId} added to fleet ${fleetId}`,
    };
  }

  @Delete(':fleetId/devices/:deviceId')
  removeDevice(
    @Param('fleetId') fleetId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const success = this.fleetService.removeDeviceFromFleet(fleetId, deviceId);
    if (!success) {
      throw new HttpException(
        'Device not in fleet or fleet not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      success: true,
      message: `Device ${deviceId} removed from fleet ${fleetId}`,
    };
  }

  @Get(':fleetId/devices')
  getFleetMembers(@Param('fleetId') fleetId: string) {
    const members = this.fleetService.getFleetMembers(fleetId);
    return {
      count: members.length,
      members,
    };
  }

  @Get('device/:deviceId/memberships')
  getDeviceMemberships(@Param('deviceId') deviceId: string) {
    const fleets = this.fleetService.getFleetsForDevice(deviceId);
    return {
      deviceId,
      fleetCount: fleets.length,
      fleets: fleets.map((f) => ({ id: f.id, name: f.name })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Fleet Broadcasts (Commands)
  // ─────────────────────────────────────────────────────────────

  @Post(':fleetId/commands/rotate')
  async rotateFleetScreen(
    @Param('fleetId') fleetId: string,
    @Body() body: { orientation: string; fullscreen?: boolean },
  ) {
    const result = await this.fleetService.rotateScreenFleet(
      fleetId,
      body.orientation,
      body.fullscreen,
    );
    return {
      success: true,
      result,
    };
  }

  @Post(':fleetId/commands/reboot')
  async rebootFleet(
    @Param('fleetId') fleetId: string,
    @Body() body: { delay_seconds?: number },
  ) {
    const result = await this.fleetService.rebootFleet(
      fleetId,
      body.delay_seconds || 0,
    );
    return {
      success: true,
      result,
    };
  }

  @Post(':fleetId/commands/network')
  async updateFleetNetwork(
    @Param('fleetId') fleetId: string,
    @Body() body: { new_ssid: string; new_password: string },
  ) {
    const result = await this.fleetService.updateNetworkFleet(
      fleetId,
      body.new_ssid,
      body.new_password,
    );
    return {
      success: true,
      result,
    };
  }

  @Post(':fleetId/commands/clock')
  async setFleetClock(
    @Param('fleetId') fleetId: string,
    @Body() body: { simulated_time: string },
  ) {
    const result = await this.fleetService.setClockFleet(
      fleetId,
      body.simulated_time,
    );
    return {
      success: true,
      result,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Fleet Broadcasts (Content)
  // ─────────────────────────────────────────────────────────────

  @Post(':fleetId/content/push')
  pushContentToFleet(@Param('fleetId') fleetId: string, @Body() body: any) {
    const contentPackage = ContentMapper.toContentPackage(body);
    const result = this.fleetService.broadcastContent(fleetId, contentPackage);
    return {
      success: true,
      result,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Serialization Helper
  // ─────────────────────────────────────────────────────────────

  private serializeFleet(fleet: ReturnType<FleetService['getFleet']>) {
    if (!fleet) return null;
    return {
      id: fleet.id,
      name: fleet.name,
      description: fleet.description,
      memberCount: fleet.members.size,
      members: Array.from(fleet.members.values()).map((m) => ({
        deviceId: m.deviceId,
        joinedAt: m.joinedAt.toISOString(),
        metadata: m.metadata,
      })),
      metadata: fleet.metadata,
      createdAt: fleet.createdAt.toISOString(),
      updatedAt: fleet.updatedAt.toISOString(),
    };
  }
}
