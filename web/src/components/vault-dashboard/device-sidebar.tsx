import {
    Monitor,
    Smartphone,
    Tablet,
    Globe,
    RefreshCw,
    MoreVertical,
    Shield,
    Plus,
    KeyRound,
    Settings,
    Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { LinkedDevice } from "@/app_lib/vault-utils/vault";
import { cn } from "@/lib/utils";

interface DeviceSidebarProps {
    vaultName: string;
    vaultDescription?: string;
    devices: LinkedDevice[];
    onSyncDevice: (deviceId: string) => void;
    onOpenVaultSettings?: () => void;
    onOpenPasswordGenerator?: () => void;
    onLockVault?: () => void;
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

export function DeviceSidebar({
    vaultName,
    vaultDescription,
    devices,
    onSyncDevice,
    onOpenVaultSettings,
    onOpenPasswordGenerator,
    onLockVault,
    isMobile,
    onClose,
}: DeviceSidebarProps) {
    const handleSidebarAction = (action?: () => void) => {
        if (!action) return;
        action();
        onClose?.();
    };

    return (
        <aside
            className={cn(
                "bg-sidebar flex h-screen w-64 flex-col",
                !isMobile && "border-border border-r",
            )}
        >
            {/* Header */}
            <div className="border-sidebar-border border-b p-4">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 border-primary/20 flex h-9 w-9 items-center justify-center rounded-lg border">
                        <Shield className="text-primary h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-foreground text-sm font-semibold">
                            {vaultName}
                        </h1>
                        {vaultDescription ? (
                            <p
                                className="text-muted-foreground line-clamp-2 text-xs"
                                title={vaultDescription}
                            >
                                {vaultDescription}
                            </p>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Devices section */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                        Linked Devices
                    </span>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Link new device</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                <ScrollArea className="flex-1 px-2">
                    <div className="space-y-1 pb-4">
                        {devices.map((device) => {
                            const Icon = deviceIcons[inferDeviceType(device.Name)];
                            const online = isDeviceOnline(device);
                            return (
                                <div
                                    key={device.ID}
                                    className="hover:bg-sidebar-accent group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                                >
                                    <div className="relative">
                                        <div
                                            className={cn(
                                                "flex h-8 w-8 items-center justify-center rounded-md",
                                                online
                                                    ? "bg-primary/10 text-primary"
                                                    : "bg-muted text-muted-foreground",
                                            )}
                                        >
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div
                                            className={cn(
                                                "border-sidebar absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2",
                                                online
                                                    ? "bg-success"
                                                    : "bg-muted-foreground",
                                            )}
                                        />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="text-foreground truncate text-sm font-medium">
                                            {device.Name || "Unnamed Device"}
                                        </p>
                                        <p className="text-muted-foreground text-xs">
                                            {online
                                                ? "Online"
                                                : formatLastSync(
                                                      getLastSyncDate(device),
                                                  )}
                                        </p>
                                    </div>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                                            >
                                                <MoreVertical className="h-3.5 w-3.5" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            className="w-48"
                                        >
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    onSyncDevice(device.ID)
                                                }
                                            >
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                Sync now
                                            </DropdownMenuItem>
                                            <DropdownMenuItem>
                                                View details
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem className="text-destructive">
                                                Unlink device
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            <div className="border-sidebar-border border-t p-2">
                <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70 mb-1 h-9 w-full justify-start gap-2 rounded-md text-xs transition-all"
                    onClick={() => handleSidebarAction(onOpenPasswordGenerator)}
                >
                    <KeyRound className="h-3.5 w-3.5" />
                    Credential Generator
                </Button>
                <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70 h-9 w-full justify-start gap-2 rounded-md text-xs transition-all"
                    onClick={() => handleSidebarAction(onOpenVaultSettings)}
                >
                    <Settings className="h-3.5 w-3.5" />
                    Vault Settings
                </Button>
                <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive hover:bg-sidebar-accent/70 h-9 w-full justify-start gap-2 rounded-md text-xs transition-all"
                    onClick={() => handleSidebarAction(onLockVault)}
                >
                    <Lock className="h-3.5 w-3.5" />
                    Lock Vault
                </Button>
            </div>
        </aside>
    );
}
