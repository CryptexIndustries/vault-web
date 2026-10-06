import type { VaultSignalingConfig } from "./link";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { DeviceConnectionStatus } from "./device-sidebar";
export type DeviceControls = {
    signalingConfig: VaultSignalingConfig;
    statuses: Record<string, DeviceConnectionStatus>;
    onConnect: (device: LinkedDevice) => void;
    onSync: (device: LinkedDevice) => void;
    onEdit: (device: LinkedDevice) => void;
    onUnlink: (device: LinkedDevice, localOnly?: boolean) => Promise<void>;
    unlinkingId: string | null;
    onCreateInvitation: () => void;
    onReceiveInvitation: () => void;
};
