import type { DeviceControls } from "../device-controls";
import type { PurchasePlan } from "@/utils/purchase-onboarding";
export type AccountDialogProps = {
    open: boolean;
    purchasePlan?: PurchasePlan | null;
    onPurchaseConsumed?: () => void;
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
