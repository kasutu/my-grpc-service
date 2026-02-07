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
  ContentPublisherService,
  AckResult,
} from "./content-publisher.service";
import { ContentMapper } from "src/content/interfaces/content.mapper";

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
    @Res({ passthrough: true }) res: Response,
  ) {
    // Convert snake_case JSON to camelCase interface
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== "false",
    });

    console.log(`Mapped deliveryId: ${contentPackage.deliveryId}`);

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const result = await this.publisher.publishToDevice(
      deviceId,
      contentPackage,
      timeout,
    );

    return this.formatResponse(result, res);
  }

  @Post("broadcast")
  @HttpCode(HttpStatus.OK)
  async broadcast(
    @Body() body: any,
    @Query("timeout") timeoutMs: string = "5000",
    @Query("ack") requireAck: string = "true",
  ) {
    const contentPackage = ContentMapper.toContentPackage({
      ...body,
      requires_ack: requireAck.toLowerCase() !== "false",
    });

    const timeout = parseInt(timeoutMs, 10) || 5000;
    const results = await this.publisher.broadcast(contentPackage, timeout);

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
