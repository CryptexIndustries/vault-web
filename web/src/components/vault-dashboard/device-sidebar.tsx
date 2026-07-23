import { useCallback, useEffect, useState } from "react";
import {
    Monitor,
    Smartphone,
    Tablet,
    Globe,
    RefreshCw,
    MoreVertical,
    Shield,
    ShieldCheck,
    Plus,
    KeyRound,
    Settings,
    Lock,
    ArrowRightToLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LinkedDevice, LinkedDevices } from "@/app_lib/vault-utils/vault";
import { cn } from "@/lib/utils";
import {
    ReceiveLinkRequestDialog,
    SendLinkRequestDialog,
    type VaultSignalingConfig,
    VaultSignalingConfigDialog,
} from "./link";
import {
    SubscriptionCtaPopover,
    type SubscriptionCtaVariant,
} from "./subscription-cta-popover";
import type { WarningDialogShowFn } from "@/components/dialog/warning";
import {
    SignalingStatus,
    WebRTCStatus,
} from "src/app_lib/synchronization-utils";
import { SyncConnectionController } from "src/app_lib/synchronization";
import { useSetAtom } from "jotai";
import { linkedDevicesAtom } from "src/utils/atoms";
import { toast } from "sonner";
import { trpcReact } from "src/utils/trpc";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { onlineServicesLog } from "src/utils/logging";

// TODO: Remove this type
export type DeviceSyncStatus = {
    state: "idle" | "connecting" | "connected" | "syncing" | "synced" | "error";
    label: string;
    error?: string;
    busy?: boolean;
};

export type DeviceConnectionStatus = {
    signalingServerStatus: SignalingStatus;
    webRTCStatus: WebRTCStatus;
    lastSync: Date | null;
};

export type DeviceConfigurationDraft = Pick<
    LinkedDevice,
    | "ID"
    | "Name"
    | "AutoConnect"
    | "AutoSync"
    | "SyncTimeout"
    | "SyncTimeoutPeriod"
>;

interface DeviceSidebarProps {
    vaultName: string;
    vaultDescription?: string;
    devices: LinkedDevice[];
    onSaveDeviceConfig: (
        config: DeviceConfigurationDraft,
    ) => Promise<void> | void;
    onOpenVaultSettings?: () => void;
    onOpenAccountDialog?: () => void;
    accountButtonLabel?: string;
    accountButtonClassName?: string;
    showSubscriptionCta?: boolean;
    subscriptionCtaVariant?: SubscriptionCtaVariant;
    onOpenPasswordGenerator?: () => void;
    onOpenSecurityReport: () => void;
    activeView: "credentials" | "security-report";
    onLockVault?: () => void;
    signalingConfig: VaultSignalingConfig;
    onSaveSignalingConfig: (
        config: VaultSignalingConfig,
    ) => Promise<void> | void;
    syncConnectionController: SyncConnectionController;
    deviceConnectionStatuses: Record<string, DeviceConnectionStatus>;
    showWarningDialog: WarningDialogShowFn;
    isMobile?: boolean;
    onClose?: () => void;
}

type DeviceIconKey = "desktop" | "mobile" | "tablet" | "browser";

const deviceIcons = {
    desktop: Monitor,
    mobile: Smartphone,
    tablet: Tablet,
    browser: Globe,
};

function inferDeviceType(name: string): DeviceIconKey {
    const normalizedName = name.toLowerCase();
    if (/iphone|android|phone/.test(normalizedName)) return "mobile";
    if (/ipad|tablet/.test(normalizedName)) return "tablet";
    if (/chrome|firefox|safari|edge|browser/.test(normalizedName))
        return "browser";
    return "desktop";
}

function getLastSyncDate(device: LinkedDevice): Date {
    if (device.LastSync) return new Date(device.LastSync);
    return new Date(device.LinkedAtTimestamp);
}

function isDeviceOnline(device: LinkedDevice): boolean {
    const onlineWindowMs = 2 * 60 * 1000;
    return Date.now() - getLastSyncDate(device).getTime() < onlineWindowMs;
}

function formatLastSync(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

function formatDateTime(date: Date): string {
    return date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

type DeviceConnectionTone = "connected" | "connecting" | "error" | "idle";

type DeviceConnectionDisplay = {
    label: string;
    title: string;
    tone: DeviceConnectionTone;
};

function getDeviceConnectionDisplay({
    webRTCStatus,
    signalingServerStatus,
    lastSyncLabel,
}: {
    webRTCStatus: WebRTCStatus;
    signalingServerStatus: SignalingStatus;
    lastSyncLabel: string;
}): DeviceConnectionDisplay {
    if (
        webRTCStatus === WebRTCStatus.Failed ||
        signalingServerStatus === SignalingStatus.Failed
    ) {
        return {
            label:
                signalingServerStatus === SignalingStatus.Failed
                    ? "Signaling failed"
                    : "Connection failed",
            title:
                signalingServerStatus === SignalingStatus.Failed
                    ? "Signaling server connection failed"
                    : "WebRTC device connection failed",
            tone: "error",
        };
    }

    if (webRTCStatus === WebRTCStatus.Connected) {
        return {
            label: `Connected - ${lastSyncLabel}`,
            title: "Device connection active",
            tone: "connected",
        };
    }

    if (webRTCStatus === WebRTCStatus.Connecting) {
        return {
            label: "Connecting...",
            title: "Opening device connection",
            tone: "connecting",
        };
    }

    if (signalingServerStatus === SignalingStatus.Connecting) {
        return {
            label: "Connecting to signaling...",
            title: "Connecting to signaling server",
            tone: "connecting",
        };
    }

    if (signalingServerStatus === SignalingStatus.Connected) {
        return {
            label: "Ready to connect",
            title: "Signaling connected; device connection not active",
            tone: "connecting",
        };
    }

    if (signalingServerStatus === SignalingStatus.Unavailable) {
        return {
            label: "Signaling unavailable",
            title: "Signaling server unavailable",
            tone: "idle",
        };
    }

    return {
        label: `Disconnected - ${lastSyncLabel}`,
        title: "Device connection closed",
        tone: "idle",
    };
}

function DeviceField({
    id,
    label,
    value,
    onChange,
    type = "text",
    min,
    disabled,
}: {
    id: string;
    label: string;
    value: string;
    onChange?: (value: string) => void;
    type?: "text" | "number";
    min?: number;
    disabled?: boolean;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type={type}
                min={min}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange?.(event.target.value)}
            />
        </div>
    );
}

function DeviceToggleRow({
    id,
    label,
    description,
    checked,
    onCheckedChange,
    disabled,
}: {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-1">
                <Label htmlFor={id}>{label}</Label>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <Switch
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={onCheckedChange}
            />
        </div>
    );
}

function DeviceConfigurationDialog({
    device,
    syncStatus,
    open,
    onOpenChange,
    onSave,
}: {
    device: LinkedDevice | null;
    syncStatus?: DeviceSyncStatus;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (config: DeviceConfigurationDraft) => Promise<void> | void;
}) {
    const [name, setName] = useState("");
    const [autoConnect, setAutoConnect] = useState(false);
    const [autoSync, setAutoSync] = useState(true);
    const [syncTimeout, setSyncTimeout] = useState(false);
    const [syncTimeoutPeriod, setSyncTimeoutPeriod] = useState("30");
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!device) return;
        setName(device.Name || "Unnamed Device");
        setAutoConnect(device.AutoConnect);
        setAutoSync(device.AutoSync);
        setSyncTimeout(device.SyncTimeout);
        setSyncTimeoutPeriod(String(device.SyncTimeoutPeriod || 30));
        setError(null);
        setIsSaving(false);
    }, [device, open]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (isSaving) return;
        onOpenChange(nextOpen);
    };

    const handleSave = async () => {
        if (!device) return;
        const trimmedName = name.trim();
        const timeoutPeriod = Number(syncTimeoutPeriod);

        if (!trimmedName) {
            setError("Device name is required.");
            return;
        }

        if (
            syncTimeout &&
            (!Number.isFinite(timeoutPeriod) ||
                !Number.isInteger(timeoutPeriod) ||
                timeoutPeriod < 1)
        ) {
            setError("Sync timeout must be a whole number greater than 0.");
            return;
        }

        setError(null);
        setIsSaving(true);

        // Wait for UI to update
        await new Promise((resolve) => setTimeout(resolve, 200));

        try {
            await onSave({
                ID: device.ID,
                Name: trimmedName,
                AutoConnect: autoConnect,
                AutoSync: autoSync,
                SyncTimeout: syncTimeout,
                SyncTimeoutPeriod:
                    Number.isFinite(timeoutPeriod) &&
                    Number.isInteger(timeoutPeriod) &&
                    timeoutPeriod > 0
                        ? timeoutPeriod
                        : device.SyncTimeoutPeriod || 30,
            });
            onOpenChange(false);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to save device configuration.",
            );
        } finally {
            setIsSaving(false);
        }
    };

    const statusLabel =
        syncStatus && syncStatus.state !== "idle"
            ? syncStatus.label
            : device
              ? isDeviceOnline(device)
                  ? "Online"
                  : formatLastSync(getLastSyncDate(device))
              : "Unknown";

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Edit device</DialogTitle>
                    <DialogDescription>
                        Update identity and sync preferences for this linked
                        device.
                    </DialogDescription>
                </DialogHeader>

                {device ? (
                    <div className="space-y-5">
                        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                                {(() => {
                                    const Icon =
                                        deviceIcons[
                                            inferDeviceType(device.Name)
                                        ];
                                    return <Icon className="h-5 w-5" />;
                                })()}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                    {device.Name || "Unnamed Device"}
                                </p>
                                <p
                                    className={cn(
                                        "text-xs",
                                        syncStatus?.state === "error"
                                            ? "text-destructive"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {statusLabel}
                                </p>
                            </div>
                            <Badge
                                variant={
                                    syncStatus?.state === "error"
                                        ? "destructive"
                                        : "secondary"
                                }
                            >
                                {syncStatus?.state === "error"
                                    ? "Error"
                                    : "Linked"}
                            </Badge>
                        </div>

                        <section className="space-y-3">
                            <div>
                                <h3 className="text-sm font-medium">
                                    Identity
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    Name shown in linked device lists and sync
                                    messages.
                                </p>
                            </div>
                            <DeviceField
                                id={`device-name-${device.ID}`}
                                label="Display name"
                                value={name}
                                onChange={setName}
                                disabled={isSaving}
                            />
                        </section>

                        <section className="space-y-3">
                            <div>
                                <h3 className="text-sm font-medium">Sync</h3>
                                <p className="text-sm text-muted-foreground">
                                    Control how this device connects during
                                    sync.
                                </p>
                            </div>
                            <DeviceToggleRow
                                id={`device-auto-connect-${device.ID}`}
                                label="Connect automatically"
                                description="Connect automatically when both devices are reachable."
                                checked={autoConnect}
                                disabled={isSaving}
                                onCheckedChange={setAutoConnect}
                            />
                            <DeviceToggleRow
                                id={`device-auto-sync-${device.ID}`}
                                label="Sync after connecting"
                                description="Synchronize immediately after connecting."
                                checked={autoSync}
                                disabled={isSaving}
                                onCheckedChange={setAutoSync}
                            />
                            <DeviceToggleRow
                                id={`device-sync-timeout-${device.ID}`}
                                label="Disconnect after inactivity"
                                description="Close stale sync connections after the timeout period."
                                checked={syncTimeout}
                                disabled={isSaving}
                                onCheckedChange={setSyncTimeout}
                            />
                            <DeviceField
                                id={`device-sync-timeout-period-${device.ID}`}
                                label="Timeout seconds"
                                type="number"
                                min={1}
                                value={syncTimeoutPeriod}
                                onChange={setSyncTimeoutPeriod}
                                disabled={isSaving || !syncTimeout}
                            />
                        </section>

                        <Separator />

                        <section className="grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                                <p className="text-muted-foreground">
                                    Device ID
                                </p>
                                <p className="truncate font-mono text-xs">
                                    {device.ID}
                                </p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Sync ID</p>
                                <p className="truncate font-mono text-xs">
                                    {device.SyncID || "Not set"}
                                </p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Linked</p>
                                <p>
                                    {formatDateTime(
                                        new Date(device.LinkedAtTimestamp),
                                    )}
                                </p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">
                                    Last sync
                                </p>
                                <p>{formatDateTime(getLastSyncDate(device))}</p>
                            </div>
                        </section>

                        {error ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {error}
                            </p>
                        ) : null}
                    </div>
                ) : null}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isSaving}
                        onClick={() => handleOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        disabled={isSaving || !device}
                        onClick={() => {
                            void handleSave();
                        }}
                    >
                        {isSaving ? "Saving..." : "Save changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function DeviceItem({
    device,
    syncConnectionController,
    connectionStatus,
    setSelectedDevice,
    setDeviceConfigOpen,
    unlinkDevice,
}: {
    device: LinkedDevice;
    syncConnectionController: SyncConnectionController;
    connectionStatus: DeviceConnectionStatus;
    setSelectedDevice: (device: LinkedDevice) => void;
    setDeviceConfigOpen: (open: boolean) => void;
    unlinkDevice: (device: LinkedDevice) => Promise<void>;
}) {
    const Icon = deviceIcons[inferDeviceType(device.Name)];
    const { signalingServerStatus, webRTCStatus, lastSync } = connectionStatus;

    const lastSyncLabel = lastSync
        ? `synced ${formatLastSync(lastSync)}`
        : "never synced";
    const connectionDisplay = getDeviceConnectionDisplay({
        webRTCStatus,
        signalingServerStatus,
        lastSyncLabel,
    });
    const isConnecting =
        webRTCStatus === WebRTCStatus.Connecting ||
        signalingServerStatus === SignalingStatus.Connecting;
    const canSync = webRTCStatus === WebRTCStatus.Connected;

    return (
        <div
            key={device.ID}
            className="hover:bg-sidebar-accent group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
        >
            <div className="relative">
                <div
                    className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md",
                        connectionDisplay.tone === "connected"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : connectionDisplay.tone === "connecting"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : connectionDisplay.tone === "error"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-muted text-muted-foreground",
                    )}
                >
                    <Icon className="h-4 w-4" />
                </div>
                <div
                    className={cn(
                        "border-sidebar absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2",
                        connectionDisplay.tone === "connected"
                            ? "bg-emerald-500"
                            : connectionDisplay.tone === "connecting"
                              ? "bg-amber-500"
                              : connectionDisplay.tone === "error"
                                ? "bg-destructive"
                                : "bg-muted-foreground",
                    )}
                />
            </div>

            <div className="min-w-0 flex-1">
                <p
                    className="truncate text-sm font-medium text-foreground"
                    title={device.Name || "Unnamed Device"}
                >
                    {device.Name || "Unnamed Device"}
                </p>
                <p
                    className={cn(
                        "text-xs",
                        connectionDisplay.tone === "error"
                            ? "text-destructive"
                            : connectionDisplay.tone === "connected"
                              ? "text-emerald-700 dark:text-emerald-400"
                              : connectionDisplay.tone === "connecting"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                    )}
                    title={connectionDisplay.title}
                >
                    {connectionDisplay.label}
                </p>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 justify-self-end opacity-0 transition-opacity group-hover:opacity-100"
                    >
                        <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="end"
                    className="w-48"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                >
                    {/* Connect to device */}
                    {webRTCStatus !== WebRTCStatus.Connected ? (
                        <DropdownMenuItem
                            onClick={() => {
                                syncConnectionController.connectDevice(
                                    device.ID,
                                );
                            }}
                            disabled={isConnecting}
                        >
                            <ArrowRightToLine className="mr-2 h-4 w-4" />
                            Connect
                        </DropdownMenuItem>
                    ) : null}

                    <DropdownMenuItem
                        disabled={!canSync || isConnecting}
                        onClick={() => {
                            syncConnectionController.transmitSyncHello(
                                device.ID,
                            );
                        }}
                    >
                        <RefreshCw
                            className={cn(
                                "mr-2 h-4 w-4",
                                isConnecting && "animate-spin",
                            )}
                        />
                        Sync now
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => {
                            setSelectedDevice(device);
                            setDeviceConfigOpen(true);
                        }}
                    >
                        View details
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                            void unlinkDevice(device);
                        }}
                    >
                        Unlink device
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

export function DeviceSidebar({
    vaultName,
    vaultDescription,
    devices,
    // onSyncDevice,
    onSaveDeviceConfig,
    onOpenVaultSettings,
    onOpenAccountDialog,
    accountButtonLabel = "Account",
    accountButtonClassName,
    showSubscriptionCta = false,
    subscriptionCtaVariant = "signup",
    onOpenPasswordGenerator,
    onOpenSecurityReport,
    activeView,
    onLockVault,
    signalingConfig,
    onSaveSignalingConfig,
    syncConnectionController,
    deviceConnectionStatuses,
    showWarningDialog,
    isMobile,
    onClose,
}: DeviceSidebarProps) {
    const [sendLinkOpen, setSendLinkOpen] = useState(false);
    const [receiveLinkOpen, setReceiveLinkOpen] = useState(false);
    const [signalingConfigOpen, setSignalingConfigOpen] = useState(false);
    const [selectedDevice, setSelectedDevice] = useState<LinkedDevice | null>(
        null,
    );
    const [deviceConfigOpen, setDeviceConfigOpen] = useState(false);

    const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const cloudServicesEnabled = isCloudServicesEnabled();
    const { mutateAsync: breakLink } =
        trpcReact.v1.device.breakLink.useMutation();

    const handleSidebarAction = (action?: () => void) => {
        if (!action) return;
        action();
        onClose?.();
    };

    const handleAccountAction = () => {
        handleSidebarAction(onOpenAccountDialog);
    };

    const confirmUnlinkDevice = useCallback(
        (device: LinkedDevice) =>
            new Promise<boolean>((resolve) => {
                showWarningDialog(
                    `Are you sure you want to unlink "${device.Name}"?`,
                    () => {
                        resolve(true);
                    },
                    () => {
                        resolve(false);
                    },
                    "Unlink Device",
                );
            }),
        [showWarningDialog],
    );

    const unlinkDevice = useCallback(
        async (device: LinkedDevice) => {
            const confirmed = await confirmUnlinkDevice(device);
            if (!confirmed) return;

            const newList = LinkedDevices.removeLinkedDevice(
                devices,
                device.ID,
            );
            setLinkedDevices(newList);
            toast.success("Device unlinked successfully.");

            if (
                cloudServicesEnabled &&
                LinkedDevices.isUsingOnlineServices(device)
            ) {
                try {
                    await breakLink({ syncId: device.SyncID });
                } catch (error) {
                    onlineServicesLog.error(
                        "Failed to remove device from Online Services.",
                        {
                            deviceId: device.ID,
                            deviceName: device.Name,
                            syncId: device.SyncID,
                            error,
                        },
                    );
                    toast.error(
                        "Failed to remove device from Online Services.",
                    );
                }
            }
        },
        [
            breakLink,
            cloudServicesEnabled,
            confirmUnlinkDevice,
            devices,
            setLinkedDevices,
        ],
    );

    return (
        <aside
            className={cn(
                "bg-sidebar flex h-screen flex-col",
                !isMobile && "border-border border-r w-64",
            )}
        >
            {/* Header */}
            <div className="border-sidebar-border border-b p-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                        <Shield className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-sm font-semibold text-foreground">
                            {vaultName}
                        </h1>
                        {vaultDescription ? (
                            <p
                                className="line-clamp-2 text-xs text-muted-foreground"
                                title={vaultDescription}
                            >
                                {vaultDescription}
                            </p>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="border-sidebar-border border-b p-2">
                <Button
                    variant="ghost"
                    className={cn(
                        "hover:bg-sidebar-accent/70 h-9 w-full justify-start gap-2 rounded-md text-xs text-muted-foreground transition-all hover:text-foreground",
                        activeView === "security-report" &&
                            "bg-sidebar-accent text-foreground",
                    )}
                    onClick={() => handleSidebarAction(onOpenSecurityReport)}
                    aria-current={
                        activeView === "security-report" ? "page" : undefined
                    }
                >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Security Report
                </Button>
            </div>

            {/* Devices section */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Linked Devices
                    </span>
                    <TooltipProvider>
                        <div className="flex items-center gap-1">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() =>
                                            setSignalingConfigOpen(true)
                                        }
                                        aria-label="Configure vault signaling"
                                    >
                                        <Settings className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Configure linking
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenu>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                aria-label="Link new device"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        Link new device
                                    </TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-52"
                                    // Avoid focus moving back to the trigger while we open a Dialog; fights Radix focus/scroll-lock.
                                    onCloseAutoFocus={(e) => e.preventDefault()}
                                >
                                    <DropdownMenuItem
                                        onSelect={() => setSendLinkOpen(true)}
                                    >
                                        Send link request
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            setReceiveLinkOpen(true)
                                        }
                                    >
                                        Receive link request
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </TooltipProvider>
                </div>

                <ScrollArea className="flex-1 px-2">
                    <div className="space-y-1 pb-4">
                        {devices.map((device) => {
                            const connectionStatus = deviceConnectionStatuses[
                                device.ID
                            ] ?? {
                                signalingServerStatus:
                                    syncConnectionController.getSignalingStatus(
                                        device.SignalingServerID,
                                    ),
                                webRTCStatus:
                                    syncConnectionController.getWebRTCStatus(
                                        device.ID,
                                    ),
                                lastSync: device.LastSync
                                    ? new Date(device.LastSync)
                                    : null,
                            };

                            return (
                                <DeviceItem
                                    key={device.ID}
                                    device={device}
                                    syncConnectionController={
                                        syncConnectionController
                                    }
                                    connectionStatus={connectionStatus}
                                    setSelectedDevice={setSelectedDevice}
                                    setDeviceConfigOpen={setDeviceConfigOpen}
                                    unlinkDevice={unlinkDevice}
                                />
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            <div className="border-sidebar-border border-t p-2">
                {cloudServicesEnabled && (
                    <SubscriptionCtaPopover
                        enabled={showSubscriptionCta}
                        variant={subscriptionCtaVariant}
                        isMobile={isMobile}
                        buttonLabel={accountButtonLabel}
                        buttonClassName={accountButtonClassName}
                        onAccountAction={handleAccountAction}
                    />
                )}
                <Button
                    variant="ghost"
                    className="hover:bg-sidebar-accent/70 mb-1 h-9 w-full justify-start gap-2 rounded-md text-xs text-muted-foreground transition-all hover:text-foreground"
                    onClick={() => handleSidebarAction(onOpenPasswordGenerator)}
                >
                    <KeyRound className="h-3.5 w-3.5" />
                    Credential Generator
                </Button>
                <Button
                    variant="ghost"
                    className="hover:bg-sidebar-accent/70 h-9 w-full justify-start gap-2 rounded-md text-xs text-muted-foreground transition-all hover:text-foreground"
                    onClick={() => handleSidebarAction(onOpenVaultSettings)}
                >
                    <Settings className="h-3.5 w-3.5" />
                    Vault Settings
                </Button>
                <Button
                    variant="ghost"
                    className="hover:bg-sidebar-accent/70 h-9 w-full justify-start gap-2 rounded-md text-xs text-muted-foreground transition-all hover:text-destructive"
                    onClick={() => handleSidebarAction(onLockVault)}
                >
                    <Lock className="h-3.5 w-3.5" />
                    Lock Vault
                </Button>
            </div>
            <SendLinkRequestDialog
                open={sendLinkOpen}
                onOpenChange={setSendLinkOpen}
                onRequireOnlineServicesSignIn={onOpenAccountDialog}
            />
            <ReceiveLinkRequestDialog
                open={receiveLinkOpen}
                onOpenChange={setReceiveLinkOpen}
                showWarningDialog={showWarningDialog}
            />
            <VaultSignalingConfigDialog
                open={signalingConfigOpen}
                onOpenChange={setSignalingConfigOpen}
                stunServers={signalingConfig.stunServers}
                turnServers={signalingConfig.turnServers}
                signalingServers={signalingConfig.signalingServers}
                onSave={onSaveSignalingConfig}
            />
            <DeviceConfigurationDialog
                open={deviceConfigOpen}
                onOpenChange={setDeviceConfigOpen}
                device={selectedDevice}
                syncStatus={
                    // selectedDevice ? syncStatuses[selectedDevice.ID] : undefined
                    undefined
                }
                onSave={onSaveDeviceConfig}
            />
        </aside>
    );
}
