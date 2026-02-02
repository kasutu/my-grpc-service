import { Controller, Post, Param, Body, Get } from '@nestjs/common';
import { ContentPublisherService } from './content-publisher.service';
import { ContentMapper } from 'src/content/interfaces/content.mapper';
import { ContentPackage } from 'src/generated/content/v1/content';

@Controller('content')
export class ContentHttpController {
  constructor(private readonly publisher: ContentPublisherService) {}

  @Post('push/:deviceId')
  pushToDevice(@Param('deviceId') deviceId: string, @Body() body: any) {
    // Convert snake_case JSON to camelCase interface
    const contentPackage: ContentPackage = ContentMapper.toContentPackage(body);

    console.log(`Mapped deliveryId: ${contentPackage.deliveryId}`);

    const success = this.publisher.publishToDevice(deviceId, contentPackage);
    return {
      success,
      message: success
        ? `Pushed to ${deviceId}`
        : `Device ${deviceId} not connected`,
      mappedId: contentPackage.deliveryId,
    };
  }

  @Post('broadcast')
  broadcast(@Body() body: any) {
    const contentPackage = ContentMapper.toContentPackage(body);
    this.publisher.broadcast(contentPackage);
    return { success: true, message: 'Broadcast sent' };
  }

  @Get('stats')
  getStats() {
    return {
      connected_devices: this.publisher.getConnectedCount(),
    };
  }
}
