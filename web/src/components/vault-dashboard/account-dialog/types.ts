export type AccountDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export type AccountDialogTab = "account" | "devices" | "security";

export type AuthMode = "register" | "recover";
