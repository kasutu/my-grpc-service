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
  Sse,
} from "@nestjs/common";
import type { Response } from "express";
import { Observable, map } from "rxjs";
import {
  ContentPublisherService,
  AckResult,
  type ProgressUpdate,
} from "./content-publisher.service";
import { ContentMapper } from "src/content/interfaces/content.mapper";

interface StreamEvent {
  event: "progress" | "complete" | "error";
  data: unknown;
}

@Controller("content")
export class ContentHttpController {
  constructor(private readonly publisher: ContentPublisherService) {}

  @Post("push/:deviceId")
  @HttpCode(HttpStatus.OK)
  async pushToDevice(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("ack") requireAck: string = "true",
    @Query("stream") streamMode: string = "false",
    @Res({ passthrough: true }) res: Response,
  ) {
    // Convert snake_case JSON to camelCase interface
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== "false",
    });

    console.log(`Mapped deliveryId: ${contentPackage.deliveryId}`);

    const timeout = parseInt(timeoutMs, 10) || 5000;

    // If stream mode is requested, return SSE stream
    if (streamMode.toLowerCase() === "true") {
      this.streamToDevice(deviceId, contentPackage, timeout, res);
      return; // Response is handled by streamToDevice
    }

    const result = await this.publisher.publishToDevice(
      deviceId,
      contentPackage,
      timeout,
    );

    return this.formatResponse(result, res);
  }

  @Post("push/:deviceId/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  pushToDeviceStream(
    @Param("deviceId") deviceId: string,
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("ack") requireAck: string = "true",
    @Res() res: Response,
  ) {
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== "false",
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    this.streamToDevice(deviceId, contentPackage, timeout, res);
    // Do not return anything - response is handled via @Res()
  }

  private streamToDevice(
    deviceId: string,
    contentPackage: any,
    timeout: number,
    res: Response,
  ): void {
    const stream$ = this.publisher.publishToDeviceStream(
      deviceId,
      contentPackage,
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

    // Set up keep-alive interval to prevent connection timeout
    const keepAliveInterval = setInterval(() => {
      res.write(":keepalive\n\n");
      if (typeof (res as unknown as { flush: () => void }).flush === "function") {
        (res as unknown as { flush: () => void }).flush();
      }
    }, 15000); // Send keepalive every 15 seconds

    const subscription = stream$.subscribe({
      next: (update: ProgressUpdate) => {
        const event = this.formatProgressEvent(update);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // Flush after each write to ensure data is sent immediately
        if (typeof (res as unknown as { flush: () => void }).flush === "function") {
          (res as unknown as { flush: () => void }).flush();
        }
      },
      complete: () => {
        clearInterval(keepAliveInterval);
        res.end();
      },
      error: (err: Error) => {
        clearInterval(keepAliveInterval);
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
      clearInterval(keepAliveInterval);
      subscription.unsubscribe();
    });
  }

  @Post("broadcast")
  @HttpCode(HttpStatus.OK)
  async broadcast(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("ack") requireAck: string = "true",
    @Query("stream") streamMode: string = "false",
    @Res({ passthrough: true }) res: Response,
  ) {
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== "false",
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;

    // If stream mode is requested, return SSE stream
    if (streamMode.toLowerCase() === "true") {
      this.streamBroadcast(contentPackage, timeout, res);
      return; // Response is handled by streamBroadcast
    }

    const results = await this.publisher.broadcast(contentPackage, timeout);

    return this.formatBroadcastResponse(results);
  }

  @Post("broadcast/stream")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  broadcastStream(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("ack") requireAck: string = "true",
    @Res() res: Response,
  ) {
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== "false",
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    this.streamBroadcast(contentPackage, timeout, res);
    // Do not return anything - response is handled via @Res()
  }

  private streamBroadcast(
    contentPackage: any,
    timeout: number,
    res: Response,
  ): void {
    const stream$ = this.publisher.broadcastStream(contentPackage, timeout);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.status(200);
    res.flushHeaders(); // Send headers immediately

    // Send an initial comment to establish connection (some clients need this)
    res.write(":ok\n\n");

    // Set up keep-alive interval to prevent connection timeout
    const keepAliveInterval = setInterval(() => {
      res.write(":keepalive\n\n");
      if (typeof (res as unknown as { flush: () => void }).flush === "function") {
        (res as unknown as { flush: () => void }).flush();
      }
    }, 15000); // Send keepalive every 15 seconds

    // Track completion state per device
    const deviceStates = new Map<
      string,
      { isFinal: boolean; success?: boolean }
    >();

    const subscription = stream$.subscribe({
      next: (
        update:
          | (ProgressUpdate & { totalDevices: number; completedDevices: number })
          | { type: "started"; totalDevices: number; deliveryId: string }
          | { type: "complete"; totalDevices: number; successful: number; failed: number },
      ) => {
        // Handle meta events (started, complete)
        if ("type" in update) {
          if (update.type === "started") {
            res.write(
              `data: ${JSON.stringify({
                event: "started",
                data: {
                  delivery_id: update.deliveryId,
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
          // Flush after each write
          if (typeof (res as unknown as { flush: () => void }).flush === "function") {
            (res as unknown as { flush: () => void }).flush();
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
        // Flush after each write to ensure data is sent immediately
        if (typeof (res as unknown as { flush: () => void }).flush === "function") {
          (res as unknown as { flush: () => void }).flush();
        }
      },
      complete: () => {
        clearInterval(keepAliveInterval);
        res.end();
      },
      error: (err: Error) => {
        clearInterval(keepAliveInterval);
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
      clearInterval(keepAliveInterval);
      subscription.unsubscribe();
    });
  }

  @Get("stats")
  getStats() {
    return {
      connected_devices: this.publisher.getConnectedCount(),
    };
  }

  private formatProgressEvent(update: ProgressUpdate): StreamEvent {
    if (update.isFinal) {
      return {
        event: update.success ? "complete" : "error",
        data: {
          delivery_id: update.deliveryId,
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
        delivery_id: update.deliveryId,
        device_id: update.deviceId,
        status: update.status,
        progress: update.progress
          ? {
              percent_complete: update.progress.percentComplete,
              total_media: update.progress.totalMediaCount,
              completed_media: update.progress.completedMediaCount,
              failed_media: update.progress.failedMediaCount,
              media_status: update.progress.mediaStatus.map((m) => ({
                media_id: m.mediaId,
                state: m.state,
                error_code: m.errorCode || undefined,
                error_message: m.errorMessage || undefined,
              })),
            }
          : undefined,
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
      delivery_id: result.deliveryId,
      device_id: result.deviceId,
      message: result.success
        ? "Content delivered successfully"
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
        delivery_id: r.deliveryId,
        error: r.errorMessage,
        timed_out: r.timedOut ?? false,
      })),
    };
  }
}
