export type CompletedDeviceAction = "connection-unlinked" | "device-removed";

/** Keeps a completed server result when local cleanup or account refresh fails. */
export class DeviceActionError extends Error {
    constructor(
        message: string,
        public readonly completedAction: CompletedDeviceAction,
        public readonly localCleanupRequired = false,
    ) {
        super(message);
        this.name = "DeviceActionError";
    }
}
