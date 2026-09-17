import type { AxilTransport, ConsoleCommand, TelemetrySnapshot, TransportCapabilities, TransportKind } from "./types";
export const WebBluetoothTransport: new () => AxilTransport;
export const WebSerialTransport: new () => AxilTransport;
export const OTA_IMAGE_MAX_SIZE: number;
export function validateOtaImage(image: Uint8Array): void;
export function unlockDeviceRuntime(accessKey: string): Promise<void>;
export function isDeviceRuntimeUnlocked(): boolean;
export function getConsoleCommands(transport: TransportKind, capabilities?: TransportCapabilities, values?: Partial<TelemetrySnapshot>): readonly ConsoleCommand[];
