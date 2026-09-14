import type { DeviceControls } from "../device-controls";
export type AccountDialogProps = {
    open: boolean;
    deviceControls: DeviceControls;
    deviceRequest?: {
        localId?: string;
        token: number;
        tab?: AccountDialogTab;
        section?: "remove";
    };
    onOpenChange: (open: boolean) => void;
};

export type AccountDialogTab = "account" | "devices" | "security";

export type AuthMode = "register" | "recover";
