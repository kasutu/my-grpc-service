import {
  Controller,
  Post,
  Param,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Res,
  Query,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CommandPublisherService,
  AckResult,
} from "./command-publisher.service";
import { CommandMapper } from "src/command/interfaces/command.mapper";

@Controller("commands")
export class CommandHttpController {
  constructor(private readonly publisher: CommandPublisherService) {}

  @Get("devices")
  getConnectedDevices() {
    const devices = this.publisher.getConnectedDevices();
    return {
      count: devices.length,
      devices: devices.map((d) => ({
        device_id: d.deviceId,
        connected_at: d.connectedAt.toISOString(),
        last_activity: d.lastActivity.toISOString(),
        connected_for_seconds: Math.floor(
          (Date.now() - d.connectedAt.getTime()) / 1000,
        ),
      })),
    };
  }

  @Post("clock/:deviceId")
  @HttpCode(HttpStatus.OK)
  async setClock(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res({ passthrough: true }) res: Response,
  ) {
    const command = CommandMapper.toCommandPackage({
      command_id: `clock-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      set_clock: {
        simulated_time: body.simulated_time ?? "",
      },
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const result = await this.publisher.sendCommand(deviceId, command, timeout);

    return this.formatResponse(result, res);
  }

  @Post("reboot/:deviceId")
  @HttpCode(HttpStatus.OK)
  async rebootDevice(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res({ passthrough: true }) res: Response,
  ) {
    const command = CommandMapper.toCommandPackage({
      command_id: `reboot-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      request_reboot: {
        delay_seconds: body.delay_seconds ?? 0,
      },
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const result = await this.publisher.sendCommand(deviceId, command, timeout);

    return this.formatResponse(result, res);
  }

  @Post("network/:deviceId")
  @HttpCode(HttpStatus.OK)
  async updateNetwork(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res({ passthrough: true }) res: Response,
  ) {
    const command = CommandMapper.toCommandPackage({
      command_id: `network-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      update_network: {
        new_ssid: body.new_ssid ?? "",
        new_password: body.new_password ?? "",
      },
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const result = await this.publisher.sendCommand(deviceId, command, timeout);

    return this.formatResponse(result, res);
  }

  @Post("rotate/:deviceId")
  @HttpCode(HttpStatus.OK)
  async rotateScreen(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res({ passthrough: true }) res: Response,
  ) {
    const command = CommandMapper.toCommandPackage({
      command_id: `rotate-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      rotate_screen: {
        orientation: body.orientation ?? "auto",
        fullscreen: body.fullscreen ?? null,
      },
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const result = await this.publisher.sendCommand(deviceId, command, timeout);

    return this.formatResponse(result, res);
  }

  @Post("broadcast/clock")
  @HttpCode(HttpStatus.OK)
  async broadcastClock(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
  ) {
    const command = CommandMapper.toCommandPackage({
      command_id: `clock-broadcast-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      set_clock: {
        simulated_time: body.simulated_time ?? "",
      },
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const results = await this.publisher.broadcastCommand(command, timeout);

    return this.formatBroadcastResponse(results);
  }

  @Post("broadcast/rotate")
  @HttpCode(HttpStatus.OK)
  async broadcastRotate(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
  ) {
    const command = CommandMapper.toCommandPackage({
      command_id: `rotate-broadcast-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      rotate_screen: {
        orientation: body.orientation ?? "auto",
        fullscreen: body.fullscreen ?? null,
      },
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const results = await this.publisher.broadcastCommand(command, timeout);

    return this.formatBroadcastResponse(results);
  }

  @Get("stats")
  getStats() {
    return {
      connected_devices: this.publisher.getConnectedCount(),
    };
  }

  private formatResponse(result: AckResult, res: Response) {
    if (!result.success) {
      if (result.errorMessage?.includes("not connected")) {
        res.status(HttpStatus.SERVICE_UNAVAILABLE);
      } else if (result.timedOut) {
        res.status(HttpStatus.REQUEST_TIMEOUT);
      } else {
        res.status(HttpStatus.BAD_GATEWAY);
      }
    }

    return {
      success: result.success,
      command_id: result.commandId,
      device_id: result.deviceId,
      message: result.success
        ? "Command executed successfully"
        : result.errorMessage,
      timed_out: result.timedOut ?? false,
    };
  }

  private formatBroadcastResponse(results: AckResult[]) {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const timedOut = failed.filter((r) => r.timedOut);

    return {
      success: failed.length === 0,
      total_devices: results.length,
      successful: successful.length,
      failed: failed.length,
      timed_out: timedOut.length,
      results: results.map((r) => ({
        device_id: r.deviceId,
        success: r.success,
        command_id: r.commandId,
        error: r.errorMessage,
        timed_out: r.timedOut ?? false,
      })),
    };
  }
}
