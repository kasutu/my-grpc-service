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
  Header,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CommandPublisherService,
  AckResult,
  type ProgressUpdate,
} from "./command-publisher.service";
import { CommandMapper } from "src/command/interfaces/command.mapper";

interface StreamEvent {
  event: "progress" | "complete" | "error";
  data: unknown;
}

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
    @Query("stream") streamMode: string = "false",
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

    // If stream mode is requested, return SSE stream
    if (streamMode.toLowerCase() === "true") {
      return this.streamCommand(deviceId, command, timeout, res);
    }

    const result = await this.publisher.sendCommand(deviceId, command, timeout);
    return this.formatResponse(result, res);
  }

  @Post("clock/:deviceId/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  async setClockStream(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res() res: Response,
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
    return this.streamCommand(deviceId, command, timeout, res);
  }

  @Post("reboot/:deviceId")
  @HttpCode(HttpStatus.OK)
  async rebootDevice(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("stream") streamMode: string = "false",
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

    if (streamMode.toLowerCase() === "true") {
      return this.streamCommand(deviceId, command, timeout, res);
    }

    const result = await this.publisher.sendCommand(deviceId, command, timeout);
    return this.formatResponse(result, res);
  }

  @Post("reboot/:deviceId/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  async rebootDeviceStream(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res() res: Response,
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
    return this.streamCommand(deviceId, command, timeout, res);
  }

  @Post("network/:deviceId")
  @HttpCode(HttpStatus.OK)
  async updateNetwork(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("stream") streamMode: string = "false",
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

    if (streamMode.toLowerCase() === "true") {
      return this.streamCommand(deviceId, command, timeout, res);
    }

    const result = await this.publisher.sendCommand(deviceId, command, timeout);
    return this.formatResponse(result, res);
  }

  @Post("network/:deviceId/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  async updateNetworkStream(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res() res: Response,
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
    return this.streamCommand(deviceId, command, timeout, res);
  }

  @Post("rotate/:deviceId")
  @HttpCode(HttpStatus.OK)
  async rotateScreen(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("stream") streamMode: string = "false",
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

    if (streamMode.toLowerCase() === "true") {
      return this.streamCommand(deviceId, command, timeout, res);
    }

    const result = await this.publisher.sendCommand(deviceId, command, timeout);
    return this.formatResponse(result, res);
  }

  @Post("rotate/:deviceId/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  async rotateScreenStream(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res() res: Response,
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
    return this.streamCommand(deviceId, command, timeout, res);
  }

  @Post("broadcast/clock")
  @HttpCode(HttpStatus.OK)
  async broadcastClock(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("stream") streamMode: string = "false",
    @Res({ passthrough: true }) res: Response,
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

    if (streamMode.toLowerCase() === "true") {
      return this.streamBroadcast(command, timeout, res);
    }

    const results = await this.publisher.broadcastCommand(command, timeout);
    return this.formatBroadcastResponse(results);
  }

  @Post("broadcast/clock/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  async broadcastClockStream(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res() res: Response,
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
    return this.streamBroadcast(command, timeout, res);
  }

  @Post("broadcast/rotate")
  @HttpCode(HttpStatus.OK)
  async broadcastRotate(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("stream") streamMode: string = "false",
    @Res({ passthrough: true }) res: Response,
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

    if (streamMode.toLowerCase() === "true") {
      return this.streamBroadcast(command, timeout, res);
    }

    const results = await this.publisher.broadcastCommand(command, timeout);
    return this.formatBroadcastResponse(results);
  }

  @Post("broadcast/rotate/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  async broadcastRotateStream(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Res() res: Response,
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
    return this.streamBroadcast(command, timeout, res);
  }

  @Get("stats")
  getStats() {
    return {
      connected_devices: this.publisher.getConnectedCount(),
    };
  }

  private streamCommand(
    deviceId: string,
    commandPackage: any,
    timeout: number,
    res: Response,
  ): void {
    const stream$ = this.publisher.sendCommandStream(
      deviceId,
      commandPackage,
      timeout,
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.status(200);
    res.flushHeaders(); // Send headers immediately

    // Send an initial comment to establish connection (some clients need this)
    res.write(":ok\n\n");

    const subscription = stream$.subscribe({
      next: (update: ProgressUpdate) => {
        const event = this.formatProgressEvent(update);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      complete: () => {
        res.end();
      },
      error: (err: Error) => {
        res.write(
          `data: ${JSON.stringify({
            event: "error",
            data: { message: err.message },
          })}\n\n`,
        );
        res.end();
      },
    });

    // Clean up subscription when client disconnects
    res.on("close", () => {
      subscription.unsubscribe();
    });
  }

  private streamBroadcast(
    commandPackage: any,
    timeout: number,
    res: Response,
  ): void {
    const stream$ = this.publisher.broadcastCommandStream(commandPackage, timeout);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.status(200);
    res.flushHeaders(); // Send headers immediately

    // Send an initial comment to establish connection (some clients need this)
    res.write(":ok\n\n");

    // Track completion state per device
    const deviceStates = new Map<
      string,
      { isFinal: boolean; success?: boolean }
    >();

    const subscription = stream$.subscribe({
      next: (
        update:
          | (ProgressUpdate & { totalDevices: number; completedDevices: number })
          | { type: "started"; totalDevices: number; commandId: string }
          | { type: "complete"; totalDevices: number; successful: number; failed: number },
      ) => {
        // Handle meta events (started, complete)
        if ("type" in update) {
          if (update.type === "started") {
            res.write(
              `data: ${JSON.stringify({
                event: "started",
                data: {
                  command_id: update.commandId,
                  total_devices: update.totalDevices,
                },
              })}\n\n`,
            );
          } else if (update.type === "complete") {
            res.write(
              `data: ${JSON.stringify({
                event: "summary",
                data: {
                  total_devices: update.totalDevices,
                  successful: update.successful,
                  failed: update.failed,
                },
              })}\n\n`,
            );
          }
          return;
        }

        // Track state for this device
        if (update.isFinal) {
          deviceStates.set(update.deviceId, {
            isFinal: true,
            success: update.success,
          });
        }

        const event = this.formatBroadcastProgressEvent(update, deviceStates);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      complete: () => {
        res.end();
      },
      error: (err: Error) => {
        res.write(
          `data: ${JSON.stringify({
            event: "error",
            data: { message: err.message },
          })}\n\n`,
        );
        res.end();
      },
    });

    // Clean up subscription when client disconnects
    res.on("close", () => {
      subscription.unsubscribe();
    });
  }

  private formatProgressEvent(update: ProgressUpdate): StreamEvent {
    if (update.isFinal) {
      return {
        event: update.success ? "complete" : "error",
        data: {
          command_id: update.commandId,
          device_id: update.deviceId,
          success: update.success,
          message: update.errorMessage,
          timed_out: update.timedOut,
        },
      };
    }

    return {
      event: "progress",
      data: {
        command_id: update.commandId,
        device_id: update.deviceId,
        status: update.status,
        message: update.errorMessage,
      },
    };
  }

  private formatBroadcastProgressEvent(
    update: ProgressUpdate & { totalDevices: number; completedDevices: number },
    deviceStates: Map<string, { isFinal: boolean; success?: boolean }>,
  ): StreamEvent {
    const baseEvent = this.formatProgressEvent(update);

    return {
      event: baseEvent.event,
      data: {
        ...(baseEvent.data as object),
        total_devices: update.totalDevices,
        completed_devices: update.completedDevices,
        remaining_devices: update.totalDevices - update.completedDevices,
      },
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
