import { Controller, Post, Param, Body, Get } from '@nestjs/common';
import { CommandPublisherService } from './command-publisher.service';
import { CommandMapper } from 'src/command/interfaces/command.mapper';

@Controller('commands')
export class CommandHttpController {
  constructor(private readonly publisher: CommandPublisherService) {}

  @Post('clock/:deviceId')
  setClock(@Param('deviceId') deviceId: string, @Body() body: any) {
    const command = CommandMapper.toCommandPackage({
      command_id: `clock-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      set_clock: {
        simulated_time: body.simulated_time ?? '',
      },
    });

    const success = this.publisher.sendCommand(deviceId, command);
    return {
      success,
      message: success
        ? `Clock command sent to ${deviceId}`
        : `Device ${deviceId} not connected`,
      commandId: command.commandId,
    };
  }

  @Post('reboot/:deviceId')
  rebootDevice(@Param('deviceId') deviceId: string, @Body() body: any) {
    const command = CommandMapper.toCommandPackage({
      command_id: `reboot-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      request_reboot: {
        delay_seconds: body.delay_seconds ?? 0,
      },
    });

    const success = this.publisher.sendCommand(deviceId, command);
    return {
      success,
      message: success
        ? `Reboot command sent to ${deviceId}`
        : `Device ${deviceId} not connected`,
      commandId: command.commandId,
    };
  }

  @Post('network/:deviceId')
  updateNetwork(@Param('deviceId') deviceId: string, @Body() body: any) {
    const command = CommandMapper.toCommandPackage({
      command_id: `network-${Date.now()}`,
      requires_ack: true,
      issued_at: new Date().toISOString(),
      update_network: {
        new_ssid: body.new_ssid ?? '',
        new_password: body.new_password ?? '',
      },
    });

    const success = this.publisher.sendCommand(deviceId, command);
    return {
      success,
      message: success
        ? `Network config sent to ${deviceId}`
        : `Device ${deviceId} not connected`,
      commandId: command.commandId,
    };
  }

  @Post('broadcast/clock')
  broadcastClock(@Body() body: any) {
    const command = CommandMapper.toCommandPackage({
      command_id: `clock-broadcast-${Date.now()}`,
      requires_ack: false,
      issued_at: new Date().toISOString(),
      set_clock: {
        simulated_time: body.simulated_time ?? '',
      },
    });

    this.publisher.broadcastCommand(command);
    return { success: true, message: 'Clock broadcast sent' };
  }

  @Get('stats')
  getStats() {
    return {
      connected_devices: this.publisher.getConnectedCount(),
    };
  }
}
