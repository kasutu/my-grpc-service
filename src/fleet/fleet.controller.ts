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
  Query,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { FleetService, FleetCommandResult } from './fleet.service';
import { ContentMapper } from '../content/interfaces/content.mapper';
import type { CreateFleetDto, UpdateFleetDto } from './interfaces/fleet.types';

@Controller('fleets')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  // ─────────────────────────────────────────────────────────────
  // Fleet CRUD
  // ─────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
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
  @HttpCode(HttpStatus.OK)
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
  @HttpCode(HttpStatus.CREATED)
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
  @HttpCode(HttpStatus.OK)
  async rotateFleetScreen(
    @Param('fleetId') fleetId: string,
    @Body() body: { orientation: string; fullscreen?: boolean },
    @Query('timeout') timeoutMs: string = '5000',
    @Res({ passthrough: true }) res: Response,
  ) {
    const timeout = parseInt(timeoutMs, 10) || 5000;
    try {
      const result = await this.fleetService.rotateScreenFleet(
        fleetId,
        body.orientation,
        body.fullscreen,
        timeout,
      );
      return this.formatFleetCommandResponse(result, res);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  @Post(':fleetId/commands/reboot')
  @HttpCode(HttpStatus.OK)
  async rebootFleet(
    @Param('fleetId') fleetId: string,
    @Body() body: { delay_seconds?: number },
    @Query('timeout') timeoutMs: string = '5000',
    @Res({ passthrough: true }) res: Response,
  ) {
    const timeout = parseInt(timeoutMs, 10) || 5000;
    try {
      const result = await this.fleetService.rebootFleet(
        fleetId,
        body.delay_seconds || 0,
        timeout,
      );
      return this.formatFleetCommandResponse(result, res);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  @Post(':fleetId/commands/network')
  @HttpCode(HttpStatus.OK)
  async updateFleetNetwork(
    @Param('fleetId') fleetId: string,
    @Body() body: { new_ssid: string; new_password: string },
    @Query('timeout') timeoutMs: string = '5000',
    @Res({ passthrough: true }) res: Response,
  ) {
    const timeout = parseInt(timeoutMs, 10) || 5000;
    try {
      const result = await this.fleetService.updateNetworkFleet(
        fleetId,
        body.new_ssid,
        body.new_password,
        timeout,
      );
      return this.formatFleetCommandResponse(result, res);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  @Post(':fleetId/commands/clock')
  @HttpCode(HttpStatus.OK)
  async setFleetClock(
    @Param('fleetId') fleetId: string,
    @Body() body: { simulated_time: string },
    @Query('timeout') timeoutMs: string = '5000',
    @Res({ passthrough: true }) res: Response,
  ) {
    const timeout = parseInt(timeoutMs, 10) || 5000;
    try {
      const result = await this.fleetService.setClockFleet(
        fleetId,
        body.simulated_time,
        timeout,
      );
      return this.formatFleetCommandResponse(result, res);
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Fleet Broadcasts (Content)
  // ─────────────────────────────────────────────────────────────

  @Post(':fleetId/content/push')
  @HttpCode(HttpStatus.OK)
  async pushContentToFleet(
    @Param('fleetId') fleetId: string,
    @Body() body: any,
    @Query('timeout') timeoutMs: string = '5000',
    @Query('ack') requireAck: string = 'true',
    @Res({ passthrough: true }) res: Response,
  ) {
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== 'false',
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    try {
      const result = await this.fleetService.broadcastContent(
        fleetId,
        contentPackage,
        timeout,
      );

      // Set status code based on result
      if (result.failed > 0) {
        if (result.successful === 0) {
          res.status(HttpStatus.BAD_GATEWAY);
        } else {
          res.status(HttpStatus.PARTIAL_CONTENT);
        }
      }

      return {
        success: result.failed === 0,
        fleet_id: result.fleetId,
        target_devices: result.targetDevices,
        successful: result.successful,
        failed: result.failed,
        failures: result.failures,
      };
    } catch (error) {
      if (error.message?.includes('not found')) {
        throw new HttpException('Fleet not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Response Helpers
  // ─────────────────────────────────────────────────────────────

  private formatFleetCommandResponse(
    result: FleetCommandResult,
    res: Response,
  ) {
    // Set status code based on result
    if (result.failed > 0) {
      if (result.successful === 0) {
        // All failed - check if it's timeout
        const hasTimeouts = result.ackResults.some((r) => r.timedOut);
        if (hasTimeouts) {
          res.status(HttpStatus.REQUEST_TIMEOUT);
        } else {
          res.status(HttpStatus.BAD_GATEWAY);
        }
      } else {
        // Partial success
        res.status(HttpStatus.PARTIAL_CONTENT);
      }
    }

    return {
      success: result.failed === 0,
      fleet_id: result.fleetId,
      target_devices: result.targetDevices,
      successful: result.successful,
      failed: result.failed,
      failures: result.failures,
      ack_results: result.ackResults.map((r) => ({
        device_id: r.deviceId,
        command_id: r.commandId,
        success: r.success,
        timed_out: r.timedOut ?? false,
        error: r.errorMessage,
      })),
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
