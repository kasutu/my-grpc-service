import type {
  CommandPackage,
  SetClockOverride,
  RequestSystemReboot,
  UpdateNetworkConfig,
  RotateScreen,
  AckRequest,
} from 'src/generated/command/v1/command';

export class CommandMapper {
  static toCommandPackage(json: any): CommandPackage {
    return {
      commandId: json.command_id?.toString() ?? '',
      requiresAck: json.requires_ack ?? false,
      issuedAt: json.issued_at ?? new Date().toISOString(),
      setClock: json.set_clock
        ? this.toSetClockOverride(json.set_clock)
        : undefined,
      requestReboot: json.request_reboot
        ? this.toRequestSystemReboot(json.request_reboot)
        : undefined,
      updateNetwork: json.update_network
        ? this.toUpdateNetworkConfig(json.update_network)
        : undefined,
      rotateScreen: json.rotate_screen
        ? this.toRotateScreen(json.rotate_screen)
        : undefined,
    };
  }

  private static toSetClockOverride(json: any): SetClockOverride {
    return {
      simulatedTime: json.simulated_time ?? '',
    };
  }

  private static toRequestSystemReboot(json: any): RequestSystemReboot {
    return {
      delaySeconds: json.delay_seconds ?? 0,
    };
  }

  private static toUpdateNetworkConfig(json: any): UpdateNetworkConfig {
    return {
      newSsid: json.new_ssid ?? '',
      newPassword: json.new_password ?? '',
    };
  }

  // ADD THIS METHOD
  private static toRotateScreen(json: any): RotateScreen {
    return {
      orientation: json.orientation ?? 'auto',
      fullscreen: json.fullscreen ?? false,
    };
  }

  static toAckRequest(json: any): AckRequest {
    return {
      deviceId: json.device_id ?? '',
      commandId: json.command_id?.toString() ?? '',
      processedSuccessfully: json.processed_successfully ?? false,
      errorMessage: json.error_message ?? '',
    };
  }

  // Update return type to include rotateScreen
  static getCommandType(
    pkg: CommandPackage,
  ):
    | 'setClock'
    | 'requestReboot'
    | 'updateNetwork'
    | 'rotateScreen'
    | 'unknown' {
    if (pkg.setClock) return 'setClock';
    if (pkg.requestReboot) return 'requestReboot';
    if (pkg.updateNetwork) return 'updateNetwork';
    if (pkg.rotateScreen) return 'rotateScreen';
    return 'unknown';
  }
}
