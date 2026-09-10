export interface OtaProgress {
  readonly phase: "handshake" | "transfer" | "waiting" | "verify" | "complete";
  readonly transferred: number;
  readonly total: number;
  readonly percent: number;
}

export type InputName = "touchLeft" | "touchRight" | "up" | "down" | "left" | "right" | "center";

export interface ConsoleCommand {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly syntax: string;
  readonly description: string;
  readonly parameters: string;
  readonly available: boolean;
}

export type TransportKind = "serial" | "bluetooth";

export type TransportState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export type DataDirection = "rx" | "tx";

export interface TransportCapabilities {
  readonly engineeringConsole: boolean;
  readonly rawData: boolean;
  readonly status: boolean;
  readonly firmwareVersion: boolean;
  readonly battery: boolean;
  readonly hearThroughLevel: boolean;
  readonly hearThroughEnabled: boolean;
  readonly hearThroughBalance: boolean;
  readonly musicVolume: boolean;
  readonly sleep: boolean;
  readonly microphone: boolean;
  readonly inputs: boolean;
  readonly charging: boolean;
  readonly ota: boolean;
  readonly protocolVersion: number;
  readonly hearThroughLevelMax: number;
  readonly musicVolumeMax: number;
  readonly simulated: boolean;
}

export interface AxilDeviceInfo {
  readonly id?: string;
  readonly name: string;
  readonly transport: TransportKind;
  readonly simulated: boolean;
}

/**
 * A partial device snapshot. Undefined fields were not reported by the active
 * transport and must be shown as unavailable rather than as zero.
 */
export interface TelemetrySnapshot {
  readonly source: "device" | "demo";
  readonly simulated: boolean;
  readonly timestamp: number;
  readonly deviceName?: string;
  readonly firmwareVersion?: string;
  readonly batteryPercent?: number;
  readonly batteryMillivolts?: number;
  readonly batteryDescription?: string;
  readonly volume?: number;
  readonly eqPreset?: number;
  readonly hearThroughEnabled?: boolean;
  readonly hearThroughLevel?: number;
  readonly hearThroughBalance?: number;
  readonly hearThroughLeftLevel?: number;
  readonly hearThroughRightLevel?: number;
  readonly volumeMax?: number;
  readonly charging?: boolean;
  readonly microphoneValid?: boolean;
  readonly microphonePeak?: number;
  readonly microphoneAgeMs?: number;
  readonly touchLeft?: boolean;
  readonly touchRight?: boolean;
  readonly joystickDirection?: "up" | "down" | "left" | "right" | "center" | "none";
  readonly inputHeld?: readonly InputName[];
  readonly inputPressed?: readonly InputName[];
  readonly inputSequence?: number;
  readonly dc5vPresent?: boolean;
  readonly frontCharge?: boolean;
  readonly btReady?: boolean;
  readonly bluetoothConnected?: boolean;
  readonly bluetoothRole?: number;
  readonly microphoneLeftDbfs?: number;
  readonly microphoneRightDbfs?: number;
  readonly microphoneAmbientDbfs?: number;
  readonly musicLeftDbfs?: number;
  readonly musicRightDbfs?: number;
}

export type TransportEvent =
  | {
      readonly type: "state";
      readonly previous: TransportState;
      readonly state: TransportState;
    }
  | { readonly type: "device"; readonly device: AxilDeviceInfo }
  | { readonly type: "capabilities"; readonly capabilities: TransportCapabilities }
  | { readonly type: "ota-log"; readonly line: string }
  | {
      readonly type: "line";
      readonly direction: DataDirection;
      readonly line: string;
    }
  | {
      readonly type: "raw";
      readonly direction: DataDirection;
      readonly data: Uint8Array;
      readonly hex: string;
    }
  | { readonly type: "telemetry"; readonly snapshot: TelemetrySnapshot }
  | { readonly type: "error"; readonly error: Error };

export type TransportEventListener = (event: TransportEvent) => void;

export interface AxilTransport {
  readonly kind: TransportKind;
  readonly state: TransportState;
  readonly capabilities: TransportCapabilities;

  on(listener: TransportEventListener): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendEngineeringCommand(command: string): Promise<void>;
  sendRaw(data: Uint8Array): Promise<void>;
  requestStatus(): Promise<void>;
  requestFirmwareVersion(): Promise<void>;
  requestBattery(): Promise<void>;
  setHearThroughEnabled(enabled: boolean): Promise<void>;
  setHearThroughLevel(level: number): Promise<void>;
  setHearThroughBalance(left: number, right: number): Promise<void>;
  setMusicVolume(volume: number): Promise<void>;
  setMicrophoneMonitor(enabled: boolean): Promise<void>;
  sleep(): Promise<void>;
  updateFirmware(image: Uint8Array, progress: (value: OtaProgress) => void, signal?: AbortSignal): Promise<void>;
}

export class UnsupportedTransportOperationError extends Error {
  constructor(operation: string, transport: TransportKind) {
    super(`${operation} is not supported by the ${transport} transport.`);
    this.name = "UnsupportedTransportOperationError";
  }
}
