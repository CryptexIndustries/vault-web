import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";

export type DeviceConfigurationDraft = Pick<
    LinkedDevice,
    | "ID"
    | "Name"
    | "AutoConnect"
    | "AutoSync"
    | "SyncTimeout"
    | "SyncTimeoutPeriod"
>;
