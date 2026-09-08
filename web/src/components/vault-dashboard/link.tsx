import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Directory,
    LinkedDevices,
    OnlineServices,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TOTP,
    TURNServerConfiguration,
    Vault,
    VaultCredential,
    packageForLinking,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    LinkingPackage,
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStatus,
    LinkingProcessStep,
} from "@cryptex-industries/vault-core/vault-utils/linking";
import {
    generateKeyPair,
    privateKeyJwkToString,
    publicKeyJwkToString,
} from "@cryptex-industries/vault-core/vault-utils/device-signing-key";
import {
    encapsulateSyncKem,
    ensureSyncKemKeypair,
} from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import {
    buildSyncKeyBundle,
    createLinkMac,
    createNonce,
    deriveAeadKey,
    linkReceiverBundleMacBytes,
    linkSenderHelloMacBytes,
    linkVaultTransferContext,
    sealAead,
    verifyLinkMac,
} from "@cryptex-industries/vault-core/vault-utils/sync-crypto";
import { ensureSyncSigningKeypair } from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import * as Synchronization from "@cryptex-industries/vault-core/synchronization";
import {
    constructLinkPresenceChannelName,
    finalizeCheckoutCompletion,
    refreshCheckoutTrpcCaches,
    type CheckoutTier,
} from "@/app_lib/online-services";
import {
    establishPremiumSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    getVaultDEKFromSession,
    MISSING_VAULT_SECRET_ERROR,
} from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    clearOnlineServicesSession,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import {
    LINK_FILE_EXTENSION,
    ONLINE_SERVICES_SELECTION_ID,
} from "@/utils/consts";
import { hasValidServerSelections } from "./send-link-server-validation";
import {
    onlineServicesLog,
    signalingLog,
    uiLog,
    vaultLog,
} from "@/utils/logging";
import { trpcReact } from "@/utils/trpc";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { cn } from "@/lib/utils";
import {
    createChunkedQRCodeFrames,
    DEFAULT_CHUNKED_QR_CHARS,
    DEFAULT_CHUNKED_QR_CYCLE_MS,
    type ChunkedQRCodeProgress,
} from "@ui/lib/chunked-qr";
import { TRPCClientError } from "@trpc/client";
import { useAtomValue } from "jotai/react";
import {
    AlertCircle,
    Camera,
    CheckCircle2,
    Download,
    Eye,
    EyeOff,
    FileText,
    ChevronDown,
    ChevronRight,
    Loader2,
    Plus,
    QrCode,
    ShieldCheck,
    Sun,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ulid } from "ulidx";
import BarcodeScanner from "@/components/general/qr-scanner";
import { CheckoutTierPicker } from "@/components/vault-dashboard/checkout-tier-picker";
import type { WarningDialogShowFn } from "@/components/dialog/warning";
import { useOnlineServicesData } from "@/app_lib/use-online-services-data";

export type SendLinkRequestDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRequireOnlineServicesSignIn?: () => void;
};

type SendLinkMethod = "qr" | "file";
type LinkStage = "configure" | "linking";
type SendLinkOutcome =
    | "idle"
    | "in_progress"
    | "success"
    | "error"
    | "cancelled";
type ProgressLogType = {
    message: string;
    type: "done" | "info" | "warn" | "error";
};

const DynamicQRCode = dynamic(() => import("react-qr-code"), { ssr: false });
const EmbeddedCheckoutDialog = dynamic(
    () =>
        import("@/components/vault-dashboard/embedded-checkout-dialog").then(
            (mod) => mod.EmbeddedCheckoutDialog,
        ),
    { ssr: false },
);
const MISSING_SYNC_SIGNING_KEY_ERROR =
    "Vault sync keys are missing. Lock and unlock the vault, then try linking again.";
const SEND_LINK_QR_CYCLE_MS = DEFAULT_CHUNKED_QR_CYCLE_MS;

const errorMessage = (error: unknown, fallback: string): string =>
    error instanceof Error && error.message ? error.message : fallback;

const requireLocalSyncKeyBundle = (
    linkedDevices: VaultUtilTypes.LinkedDevices,
): VaultUtilTypes.SyncKeyBundle => {
    if (
        !linkedDevices.SyncSigningPublicKey ||
        !linkedDevices.SyncSigningPrivateKey ||
        !linkedDevices.SyncKemPublicKey ||
        !linkedDevices.SyncKemPrivateKey
    ) {
        throw new Error(MISSING_SYNC_SIGNING_KEY_ERROR);
    }
    return buildSyncKeyBundle(
        linkedDevices.SyncSigningPublicKey,
        linkedDevices.SyncKemPublicKey,
    );
};

const SEND_LINK_PREFERENCES_KEY = "cryptex-send-link-preferences";

type SendLinkPreferences = {
    linkMethod: SendLinkMethod;
    signalingServerID: string;
    stunServerIDs: string[];
    turnServerIDs: string[];
    rootDevice: boolean;
};

const defaultSendLinkPreferences = (): SendLinkPreferences => {
    const cloudEnabled = isCloudServicesEnabled();
    return {
        linkMethod: "qr",
        signalingServerID: cloudEnabled ? ONLINE_SERVICES_SELECTION_ID : "",
        stunServerIDs: cloudEnabled ? [ONLINE_SERVICES_SELECTION_ID] : [],
        turnServerIDs: cloudEnabled ? [ONLINE_SERVICES_SELECTION_ID] : [],
        rootDevice: false,
    };
};

const loadSendLinkPreferences = (): SendLinkPreferences => {
    if (typeof window === "undefined") {
        return defaultSendLinkPreferences();
    }

    try {
        const raw = localStorage.getItem(SEND_LINK_PREFERENCES_KEY);
        if (!raw) return defaultSendLinkPreferences();

        const parsed = JSON.parse(raw) as Partial<SendLinkPreferences>;
        const cloudEnabled = isCloudServicesEnabled();
        return {
            ...defaultSendLinkPreferences(),
            ...parsed,
            linkMethod: parsed.linkMethod === "file" ? "file" : "qr",
            stunServerIDs:
                Array.isArray(parsed.stunServerIDs) &&
                parsed.stunServerIDs.length > 0
                    ? parsed.stunServerIDs.filter(
                          (id) =>
                              cloudEnabled ||
                              id !== ONLINE_SERVICES_SELECTION_ID,
                      )
                    : cloudEnabled
                      ? [ONLINE_SERVICES_SELECTION_ID]
                      : [],
            turnServerIDs:
                Array.isArray(parsed.turnServerIDs) &&
                parsed.turnServerIDs.length > 0
                    ? parsed.turnServerIDs.filter(
                          (id) =>
                              cloudEnabled ||
                              id !== ONLINE_SERVICES_SELECTION_ID,
                      )
                    : cloudEnabled
                      ? [ONLINE_SERVICES_SELECTION_ID]
                      : [],
        };
    } catch {
        return defaultSendLinkPreferences();
    }
};

const saveSendLinkPreferences = (preferences: SendLinkPreferences) => {
    try {
        localStorage.setItem(
            SEND_LINK_PREFERENCES_KEY,
            JSON.stringify(preferences),
        );
    } catch {
        // Ignore quota or privacy-mode storage errors.
    }
};

const hasCustomConnectionSettings = (
    preferences: SendLinkPreferences,
): boolean => {
    const cloudEnabled = isCloudServicesEnabled();
    const signalingCustom = cloudEnabled
        ? preferences.signalingServerID !== ONLINE_SERVICES_SELECTION_ID
        : preferences.signalingServerID !== "";
    const stunCustom = preferences.stunServerIDs.some(
        (id) => id !== (cloudEnabled ? ONLINE_SERVICES_SELECTION_ID : ""),
    );
    const turnCustom = preferences.turnServerIDs.some(
        (id) => id !== (cloudEnabled ? ONLINE_SERVICES_SELECTION_ID : ""),
    );
    return (
        signalingCustom || stunCustom || turnCustom || preferences.rootDevice
    );
};

// hasValidServerSelections is imported from ./send-link-server-validation so it
// can be unit-tested in isolation from the React component.

const sendLinkMethodCopy: Record<
    SendLinkMethod,
    { title: string; description: string; icon: typeof QrCode }
> = {
    qr: {
        title: "QR code",
        description: "Scan from the receiving device. Best for nearby screens.",
        icon: QrCode,
    },
    file: {
        title: "File",
        description:
            "Download a link file and move it to the receiving device.",
        icon: FileText,
    },
};

function LinkingQRCode({
    value,
    cycleMs = DEFAULT_CHUNKED_QR_CYCLE_MS,
    chunkChars = DEFAULT_CHUNKED_QR_CHARS,
}: {
    value: string;
    cycleMs?: number;
    chunkChars?: number;
}) {
    const [copied, setCopied] = useState(false);
    const [frames, setFrames] = useState<string[]>([]);
    const [activeFrameIndex, setActiveFrameIndex] = useState(0);
    const [frameError, setFrameError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setFrameError("");
        setFrames(value.length <= chunkChars ? [value] : []);
        setActiveFrameIndex(0);

        void createChunkedQRCodeFrames(value, chunkChars)
            .then((nextFrames) => {
                if (cancelled) return;
                setFrames(nextFrames);
                setActiveFrameIndex(0);
            })
            .catch(() => {
                if (cancelled) return;
                setFrameError("Failed to prepare QR code chunks.");
                setFrames([]);
            });

        return () => {
            cancelled = true;
        };
    }, [chunkChars, value]);

    useEffect(() => {
        if (frames.length <= 1) return;

        const interval = window.setInterval(() => {
            setActiveFrameIndex((index) => (index + 1) % frames.length);
        }, cycleMs);

        return () => window.clearInterval(interval);
    }, [cycleMs, frames.length]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.info("QR payload copied.");
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error("Failed to copy QR payload.");
        }
    };

    const frameValue = frames[activeFrameIndex] ?? "";

    return (
        <button
            type="button"
            onClick={copy}
            className="group inline-flex flex-col items-center gap-2 rounded-xl border bg-background p-3 text-center transition hover:bg-muted/50"
        >
            <span className="rounded-lg bg-white p-3">
                {frameValue ? (
                    <DynamicQRCode value={frameValue} size={300} />
                ) : (
                    <span className="flex h-[300px] w-[300px] items-center justify-center text-xs text-muted-foreground">
                        {frameError || "Preparing QR chunks..."}
                    </span>
                )}
            </span>
            {frames.length > 1 ? (
                <span className="text-xs text-muted-foreground">
                    Part {activeFrameIndex + 1} of {frames.length}
                </span>
            ) : null}
            <TooltipProvider delayDuration={300}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Sun className="h-3.5 w-3.5" />
                            {copied ? "Copied" : "Click QR to copy payload"}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        Increase display brightness for reliable scanning.
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </button>
    );
}

function SendLinkMethodPicker({
    value,
    onChange,
}: {
    value: SendLinkMethod;
    onChange: (method: SendLinkMethod) => void;
}) {
    return (
        <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(sendLinkMethodCopy) as SendLinkMethod[]).map(
                (method) => {
                    const copy = sendLinkMethodCopy[method];
                    const Icon = copy.icon;
                    const active = value === method;

                    return (
                        <button
                            key={method}
                            type="button"
                            onClick={() => onChange(method)}
                            className={cn(
                                "rounded-lg border p-3 text-left transition",
                                active && "border-primary bg-primary/10",
                            )}
                        >
                            <Icon className="mb-2 h-4 w-4" />
                            <span className="block text-sm font-medium">
                                {copy.title}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {copy.description}
                            </span>
                        </button>
                    );
                },
            )}
        </div>
    );
}

function ProgressLog({ entries }: { entries: ProgressLogType[] }) {
    if (!entries.length) {
        return (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Log appears here when linking starts.
            </div>
        );
    }

    const colors: Record<ProgressLogType["type"], string> = {
        done: "text-emerald-600 dark:text-emerald-400",
        info: "text-muted-foreground",
        warn: "text-amber-600 dark:text-amber-400",
        error: "text-destructive",
    };

    return (
        <ScrollArea className="h-44 rounded-lg border bg-muted/20">
            <div className="space-y-2 p-3">
                {entries.map((entry, index) => (
                    <div
                        key={`${entry.message}-${index}`}
                        className="flex gap-2 text-xs"
                    >
                        <span
                            className={cn(
                                "mt-0.5 w-10 shrink-0",
                                colors[entry.type],
                            )}
                        >
                            {entry.type === "done" ? "ok" : entry.type}
                        </span>
                        <span className="text-foreground">{entry.message}</span>
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}

function ServerSelect({
    label,
    value,
    onChange,
    servers,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    servers: { ID: string; Name: string; Host?: string }[];
}) {
    const cloudServicesEnabled = isCloudServicesEnabled();
    const displayValue =
        value === ONLINE_SERVICES_SELECTION_ID && !cloudServicesEnabled
            ? "no-servers"
            : value;
    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            <Select value={displayValue} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue
                        placeholder={
                            cloudServicesEnabled &&
                            value === ONLINE_SERVICES_SELECTION_ID
                                ? "Cryptex Online Services"
                                : servers.length > 0
                                  ? undefined
                                  : "No servers configured"
                        }
                    />
                </SelectTrigger>
                <SelectContent>
                    {cloudServicesEnabled ? (
                        <SelectItem value={ONLINE_SERVICES_SELECTION_ID}>
                            Cryptex Online Services
                        </SelectItem>
                    ) : null}
                    {servers.map((server) => (
                        <SelectItem key={server.ID} value={server.ID}>
                            {server.Name || server.Host || "Unnamed server"}
                        </SelectItem>
                    ))}
                    {servers.length === 0 && !cloudServicesEnabled ? (
                        <SelectItem value="no-servers" disabled>
                            No servers configured
                        </SelectItem>
                    ) : null}
                </SelectContent>
            </Select>
        </div>
    );
}

function ServerMultiSelect({
    label,
    value,
    onChange,
    servers,
}: {
    label: string;
    value: string[];
    onChange: (value: string[]) => void;
    servers: { ID: string; Name: string; Host?: string }[];
}) {
    const cloudServicesEnabled = isCloudServicesEnabled();
    const selectedServers = servers.filter((server) =>
        value.includes(server.ID),
    );
    const usesOnlineServices =
        cloudServicesEnabled && value.includes(ONLINE_SERVICES_SELECTION_ID);
    const selectedLabel = usesOnlineServices
        ? "Cryptex Online Services"
        : selectedServers.length === 1
          ? selectedServers[0]?.Name ||
            selectedServers[0]?.Host ||
            "Unnamed server"
          : selectedServers.length > 1
            ? `${selectedServers.length} servers selected`
            : cloudServicesEnabled
              ? "Cryptex Online Services"
              : selectedServers.length === 0
                ? "Select servers"
                : "Unnamed server";

    const toggleServer = (serverID: string, checked: boolean) => {
        if (serverID === ONLINE_SERVICES_SELECTION_ID) {
            onChange([ONLINE_SERVICES_SELECTION_ID]);
            return;
        }

        const selected = new Set(
            value.filter((id) => id !== ONLINE_SERVICES_SELECTION_ID),
        );
        if (checked) {
            selected.add(serverID);
        } else {
            selected.delete(serverID);
        }

        onChange(
            selected.size > 0
                ? Array.from(selected)
                : cloudServicesEnabled
                  ? [ONLINE_SERVICES_SELECTION_ID]
                  : [],
        );
    };

    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start font-normal"
                    >
                        <span className="truncate">{selectedLabel}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                    {cloudServicesEnabled ? (
                        <DropdownMenuCheckboxItem
                            checked={usesOnlineServices}
                            onCheckedChange={(checked) =>
                                toggleServer(
                                    ONLINE_SERVICES_SELECTION_ID,
                                    checked === true,
                                )
                            }
                            onSelect={(event) => event.preventDefault()}
                        >
                            Cryptex Online Services
                        </DropdownMenuCheckboxItem>
                    ) : null}
                    {servers.map((server) => (
                        <DropdownMenuCheckboxItem
                            key={server.ID}
                            checked={value.includes(server.ID)}
                            onCheckedChange={(checked) =>
                                toggleServer(server.ID, checked === true)
                            }
                            onSelect={(event) => event.preventDefault()}
                        >
                            {server.Name || server.Host || "Unnamed server"}
                        </DropdownMenuCheckboxItem>
                    ))}
                    {servers.length === 0 && !cloudServicesEnabled ? (
                        <DropdownMenuCheckboxItem disabled>
                            No servers configured
                        </DropdownMenuCheckboxItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

type SendLinkLinkingView = "active" | "success" | "cancelled" | "error";

const getSendLinkLinkingView = (
    outcome: SendLinkOutcome,
): SendLinkLinkingView => {
    if (outcome === "success") return "success";
    if (outcome === "cancelled") return "cancelled";
    if (outcome === "error") return "error";
    return "active";
};

const getSendLinkDialogTitle = (
    stage: LinkStage,
    outcome: SendLinkOutcome,
): string => {
    if (stage !== "linking") return "Link new device";
    if (outcome === "success") return "Device linked";
    if (outcome === "cancelled") return "Linking cancelled";
    if (outcome === "error") return "Linking failed";
    return "Link new device";
};

const getLatestLinkingErrorMessage = (
    progressLog: ProgressLogType[],
): string => {
    const latest = progressLog.find((entry) => entry.type === "error");
    return latest?.message ?? "Linking failed.";
};

const getSendLinkStatusMessage = (
    progressLog: ProgressLogType[],
    readyForOtherDevice: boolean,
    linkMethod: SendLinkMethod,
): string => {
    if (progressLog[0]?.message) return progressLog[0].message;

    if (!readyForOtherDevice) return "Preparing private connection...";

    return linkMethod === "qr"
        ? "Scan the QR code on the receiving device."
        : "Import the link file on the receiving device, then enter the mnemonic.";
};

function SendLinkLogToggle({
    open,
    onToggle,
    openLabel,
    closedLabel,
    entries,
}: {
    open: boolean;
    onToggle: () => void;
    openLabel: string;
    closedLabel: string;
    entries: ProgressLogType[];
}) {
    if (!entries.length) return null;

    return (
        <div className="space-y-2">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={onToggle}
            >
                {open ? openLabel : closedLabel}
            </Button>
            {open ? <ProgressLog entries={entries} /> : null}
        </div>
    );
}

function SendLinkTerminalPanel({
    variant,
    linkedDeviceName,
    errorMessage,
    progressLog,
    showLogDetails,
    onToggleLogDetails,
}: {
    variant: "success" | "cancelled" | "error";
    linkedDeviceName: string;
    errorMessage?: string;
    progressLog: ProgressLogType[];
    showLogDetails: boolean;
    onToggleLogDetails: () => void;
}) {
    const isSuccess = variant === "success";
    const isError = variant === "error";

    return (
        <>
            <div
                className={cn(
                    "flex flex-col items-center justify-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm",
                    isSuccess
                        ? "min-h-56 border-emerald-500/50"
                        : isError
                          ? "min-h-40 border-destructive/40"
                          : "min-h-40",
                )}
            >
                {isSuccess ? (
                    <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                ) : isError ? (
                    <AlertCircle className="h-10 w-10 text-destructive" />
                ) : (
                    <X className="h-10 w-10 text-muted-foreground" />
                )}
                <div className="space-y-1">
                    <p className="text-lg font-semibold text-foreground">
                        {isSuccess
                            ? "Device linked successfully"
                            : isError
                              ? "Linking failed"
                              : "Linking cancelled"}
                    </p>
                    {isSuccess ? (
                        <>
                            <p className="text-sm text-muted-foreground">
                                <span className="font-medium text-foreground">
                                    {linkedDeviceName}
                                </span>{" "}
                                was added to linked devices.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                It will appear in the device sidebar.
                            </p>
                        </>
                    ) : isError ? (
                        <>
                            <p className="text-sm text-destructive">
                                {errorMessage}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                QR code, link file, and mnemonic were cleared.
                                Start over to try again.
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            QR code, link file, and mnemonic were cleared. Start
                            over to create a new link request.
                        </p>
                    )}
                </div>
            </div>

            <SendLinkLogToggle
                open={showLogDetails}
                onToggle={onToggleLogDetails}
                openLabel={isSuccess ? "Hide what happened" : "Hide details"}
                closedLabel={isSuccess ? "What happened?" : "Show details"}
                entries={progressLog}
            />
        </>
    );
}

function SendLinkActiveLinkingPanel({
    statusMessage,
    linkMethod,
    linkingPackageBase64,
    linkingPackageBinary,
    mnemonic,
    mnemonicOpen,
    onToggleMnemonic,
    onDownloadAgain,
    progressLog,
    showLogDetails,
    onToggleLogDetails,
}: {
    statusMessage: string;
    linkMethod: SendLinkMethod;
    linkingPackageBase64: string;
    linkingPackageBinary: Uint8Array | null;
    mnemonic: string;
    mnemonicOpen: boolean;
    onToggleMnemonic: () => void;
    onDownloadAgain: () => void;
    progressLog: ProgressLogType[];
    showLogDetails: boolean;
    onToggleLogDetails: () => void;
}) {
    return (
        <>
            <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">{statusMessage}</span>
            </div>

            <div className="flex items-center justify-center rounded-xl border bg-muted/10 p-4">
                {linkMethod === "qr" ? (
                    linkingPackageBase64 ? (
                        <LinkingQRCode
                            value={linkingPackageBase64}
                            cycleMs={SEND_LINK_QR_CYCLE_MS}
                        />
                    ) : (
                        <div className="text-sm text-muted-foreground">
                            QR code preparing...
                        </div>
                    )
                ) : (
                    <div className="space-y-3 text-center">
                        <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                        <p className="text-sm font-medium">
                            Link file downloaded
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Import it on the receiving device, then enter the
                            mnemonic below.
                        </p>
                        {linkingPackageBinary ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={onDownloadAgain}
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Download again
                            </Button>
                        ) : null}
                    </div>
                )}
            </div>

            <div className="rounded-xl border">
                <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                    onClick={onToggleMnemonic}
                >
                    <span className="text-sm font-medium">Mnemonic</span>
                    <ChevronDown
                        className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            mnemonicOpen && "rotate-180",
                        )}
                    />
                </button>
                {mnemonicOpen ? (
                    <div className="border-t px-4 py-2">
                        {mnemonic ? (
                            <p className="select-all rounded-lg bg-muted p-3 text-xs leading-relaxed">
                                {mnemonic}
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Generated after link package is ready.
                            </p>
                        )}
                    </div>
                ) : null}
            </div>

            <SendLinkLogToggle
                open={showLogDetails}
                onToggle={onToggleLogDetails}
                openLabel="Hide details"
                closedLabel="Show details"
                entries={progressLog}
            />
        </>
    );
}

export function SendLinkRequestDialog({
    open,
    onOpenChange,
    onRequireOnlineServicesSignIn,
}: SendLinkRequestDialogProps) {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const onlineServicesData = useOnlineServicesData();
    const { mutateAsync: linkNewDevice } =
        trpcReact.v1.device.link.useMutation();
    const trpcUtils = trpcReact.useUtils();
    const { mutateAsync: setLinkedDeviceRoot } =
        trpcReact.v1.device.setRoot.useMutation();
    const removeDevice = trpcReact.v1.device.remove.useMutation();

    const [stage, setStage] = useState<LinkStage>("configure");
    const [deviceName, setDeviceName] = useState("My Device");
    const [signalingServerID, setSignalingServerID] = useState(
        ONLINE_SERVICES_SELECTION_ID,
    );
    const [stunServerIDs, setSTUNServerIDs] = useState<string[]>([
        ONLINE_SERVICES_SELECTION_ID,
    ]);
    const [turnServerIDs, setTURNServerIDs] = useState<string[]>([
        ONLINE_SERVICES_SELECTION_ID,
    ]);
    const [rootDevice, setRootDevice] = useState(false);
    const [selectedLinkMethod, setSelectedLinkMethod] =
        useState<SendLinkMethod>("qr");
    const [advancedAccordion, setAdvancedAccordion] = useState("");
    const [showLogDetails, setShowLogDetails] = useState(false);
    const [mnemonicOpen, setMnemonicOpen] = useState(false);
    const [linkingOutcome, setLinkingOutcome] =
        useState<SendLinkOutcome>("idle");
    const [linkedDeviceName, setLinkedDeviceName] = useState("");
    const [readyForOtherDevice, setReadyForOtherDevice] = useState(false);
    const [progressLog, setProgressLog] = useState<ProgressLogType[]>([]);
    const [mnemonic, setMnemonic] = useState("");
    const [linkingPackageBase64, setLinkingPackageBase64] = useState("");
    const [linkingPackageBinary, setLinkingPackageBinary] =
        useState<Uint8Array | null>(null);
    const [formError, setFormError] = useState("");
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [checkoutTier, setCheckoutTier] =
        useState<CheckoutTier>("premiumMonthly");
    const [planSyncPending, setPlanSyncPending] = useState(false);
    const checkoutFinalizeAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!open) {
            checkoutFinalizeAbortRef.current?.abort();
            checkoutFinalizeAbortRef.current = null;
        }
    }, [open]);

    const progressLogRef = useRef<ProgressLogType[]>([]);
    const selectedLinkMethodRef = useRef<SendLinkMethod>("qr");
    const vaultTransferSentRef = useRef(false);
    const onlineServicesRollbackAttemptedRef = useRef(false);
    const cancelFnRef = useRef<() => Promise<void> | void>(() => {
        // No active linking attempt.
    });

    const isSignedIn = Vault.isOnlineServicesBound(unlockedVault);
    const cloudServicesEnabled = isCloudServicesEnabled();
    const { data: subscription } = trpcReact.v1.payment.subscription.useQuery(
        undefined,
        { enabled: open && cloudServicesEnabled && isSignedIn },
    );
    const tierAllowsLinkingWithOnlineServices =
        cloudServicesEnabled &&
        isSignedIn &&
        !!onlineServicesData?.remoteData?.canLink;
    const usesOnlineServicesSelection =
        cloudServicesEnabled &&
        (signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
            stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
            turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID));

    const onlineServicesIssue =
        usesOnlineServicesSelection && !isSignedIn
            ? "signin"
            : usesOnlineServicesSelection &&
                !tierAllowsLinkingWithOnlineServices &&
                subscription?.nonFree
              ? "plan-sync"
              : usesOnlineServicesSelection &&
                  !tierAllowsLinkingWithOnlineServices &&
                  !subscription?.nonFree
                ? "upgrade"
                : null;

    const hasValidServerSelectionsLocal = hasValidServerSelections(
        cloudServicesEnabled,
        signalingServerID,
        stunServerIDs,
        turnServerIDs,
        unlockedVault.LinkedDevices.SignalingServers,
        unlockedVault.LinkedDevices.STUNServers,
        unlockedVault.LinkedDevices.TURNServers,
    );

    const canStart =
        deviceName.trim().length > 0 &&
        deviceName.trim().length <= 150 &&
        onlineServicesIssue == null &&
        hasValidServerSelectionsLocal;
    const isLinkingActive = linkingOutcome === "in_progress";
    const linkingView = getSendLinkLinkingView(linkingOutcome);
    const dialogTitle = getSendLinkDialogTitle(stage, linkingOutcome);

    const addToProgressLog = (
        message: string,
        type: ProgressLogType["type"] = "done",
    ) => {
        const newProgressLog = [{ message, type }, ...progressLogRef.current];
        progressLogRef.current = newProgressLog;
        setProgressLog(newProgressLog);
    };

    const rollbackRegisteredOnlineServicesDevice = async (
        deviceId: string | null | undefined,
    ) => {
        if (
            !deviceId ||
            vaultTransferSentRef.current ||
            onlineServicesRollbackAttemptedRef.current
        ) {
            return;
        }

        onlineServicesRollbackAttemptedRef.current = true;
        addToProgressLog("Rollback - cleaning registration...", "info");

        try {
            await removeDevice.mutateAsync({ id: deviceId });
            addToProgressLog("Rollback complete.", "info");
        } catch (error) {
            onlineServicesLog.error(
                "Failed to remove linked device during rollback",
                {
                    deviceId,
                    error,
                },
            );
            addToProgressLog(
                "Rollback failed. Remove device manually.",
                "error",
            );
        }
    };

    const resetLinkingProgress = () => {
        setProgressLog([]);
        progressLogRef.current = [];
        setShowLogDetails(false);
        setMnemonicOpen(false);
        vaultTransferSentRef.current = false;
        onlineServicesRollbackAttemptedRef.current = false;
        setFormError("");
        cancelFnRef.current = () => {
            // No active linking attempt.
        };
    };

    const clearLinkTransferSecrets = () => {
        setMnemonic("");
        setLinkingPackageBase64("");
        setLinkingPackageBinary(null);
        setMnemonicOpen(false);
    };

    const applyLinkingOutcome = (
        outcome: SendLinkOutcome,
        options?: { linkedName?: string },
    ) => {
        setLinkingOutcome((current) => {
            if (
                (current === "success" || current === "cancelled") &&
                outcome === "error"
            ) {
                return current;
            }
            return outcome;
        });

        if (options?.linkedName !== undefined) {
            setLinkedDeviceName(options.linkedName);
        }

        switch (outcome) {
            case "success":
            case "cancelled":
            case "error":
                clearLinkTransferSecrets();
                setShowLogDetails(false);
                setReadyForOtherDevice(false);
                break;
            case "in_progress":
                setLinkedDeviceName("");
                setReadyForOtherDevice(false);
                break;
            case "idle":
                setLinkedDeviceName("");
                setReadyForOtherDevice(false);
                break;
        }
    };

    const resetDialog = () => {
        const preferences = loadSendLinkPreferences();
        setStage("configure");
        setDeviceName("My Device");
        setSignalingServerID(preferences.signalingServerID);
        setSTUNServerIDs(preferences.stunServerIDs);
        setTURNServerIDs(preferences.turnServerIDs);
        setRootDevice(preferences.rootDevice);
        setSelectedLinkMethod(preferences.linkMethod);
        selectedLinkMethodRef.current = preferences.linkMethod;
        setAdvancedAccordion(
            hasCustomConnectionSettings(preferences) ? "advanced" : "",
        );
        setShowLogDetails(false);
        setMnemonicOpen(false);
        setLinkingOutcome("idle");
        setLinkedDeviceName("");
        clearLinkTransferSecrets();
        resetLinkingProgress();
    };

    useEffect(() => {
        if (open) resetDialog();
    }, [open]);

    const returnToConfigure = () => {
        setStage("configure");
        setLinkingOutcome("idle");
        setLinkedDeviceName("");
        resetLinkingProgress();
    };

    const downloadLinkingPackage = (
        packageBinary: Uint8Array | null,
        name = deviceName,
    ) => {
        if (!packageBinary) return;

        const blob = new Blob([new Uint8Array(packageBinary)], {
            type: "application/octet-stream",
        });
        const normalizedDeviceName = name
            .trim()
            .replaceAll(" ", "-")
            .toLowerCase();
        const fileName = `vault-linking-${normalizedDeviceName}-${Date.now()}.${LINK_FILE_EXTENSION}`;
        const link = document.createElement("a");
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const persistSendLinkPreferences = () => {
        saveSendLinkPreferences({
            linkMethod: selectedLinkMethodRef.current,
            signalingServerID,
            stunServerIDs,
            turnServerIDs,
            rootDevice,
        });
    };

    const selectLinkMethod = (method: SendLinkMethod) => {
        selectedLinkMethodRef.current = method;
        setSelectedLinkMethod(method);
        saveSendLinkPreferences({
            linkMethod: method,
            signalingServerID,
            stunServerIDs,
            turnServerIDs,
            rootDevice,
        });
    };

    const prepareConnectionPackage = async (
        usesOnlineServices: boolean,
        isDeviceRoot: boolean,
        stunServers: VaultUtilTypes.STUNServerConfiguration[],
        turnServers: VaultUtilTypes.TURNServerConfiguration[],
        signalingServer:
            | VaultUtilTypes.SignalingServerConfiguration
            | undefined,
    ) => {
        let linkedPeerOnlineServices: OnlineServices | null = null;
        let syncId = ulid();

        if (usesOnlineServices && unlockedVault.OnlineServices) {
            try {
                addToProgressLog(
                    "Registering new device with Online Services...",
                    "info",
                );

                const { publicKey, privateKey } = await generateKeyPair();
                const publicKeyJWK = publicKeyJwkToString(publicKey);
                const privateKeyJWK = privateKeyJwkToString(privateKey);
                const ret = await linkNewDevice({ publicKeyJWK });

                syncId = ret.syncId;
                linkedPeerOnlineServices = new OnlineServices(
                    ret.deviceId,
                    unlockedVault.OnlineServices.UserID,
                    publicKeyJWK,
                    privateKeyJWK,
                    isDeviceRoot,
                );

                addToProgressLog("Device registered.");

                if (isDeviceRoot) {
                    addToProgressLog(
                        "Promoting linked device to root...",
                        "info",
                    );

                    try {
                        await setLinkedDeviceRoot({
                            id: ret.deviceId,
                            root: true,
                        });
                        addToProgressLog("Linked device promoted to root.");
                    } catch (promotionError) {
                        addToProgressLog(
                            "Root promotion failed. Rolling back registration...",
                            "error",
                        );

                        try {
                            await removeDevice.mutateAsync({
                                id: ret.deviceId,
                            });
                            addToProgressLog("Rollback complete.", "info");
                        } catch (rollbackError) {
                            onlineServicesLog.error(
                                "Failed to roll back linked device registration",
                                {
                                    deviceId: ret.deviceId,
                                    error: rollbackError,
                                },
                            );
                            addToProgressLog(
                                "Rollback failed. Remove linked device manually before retrying.",
                                "error",
                            );
                        }

                        throw promotionError;
                    }
                }
            } catch (error) {
                addToProgressLog(
                    error instanceof TRPCClientError
                        ? `Failed to register device: ${error.message}`
                        : "Failed to register device with Online Services.",
                    "error",
                );
                throw error;
            }
        }

        try {
            addToProgressLog("Encrypting link package...", "info");
            const senderKeyBundle = requireLocalSyncKeyBundle(
                unlockedVault.LinkedDevices,
            );

            const { linkingPackage, mnemonic } =
                await LinkingPackage.createNewPackage({
                    SyncID: syncId,
                    STUNServers: stunServers,
                    TURNServers: turnServers,
                    SignalingServer: signalingServer,
                    OnlineServices: linkedPeerOnlineServices ?? undefined,
                    SenderKeyBundle: senderKeyBundle,
                });

            setMnemonic(mnemonic);
            addToProgressLog("Link package ready.");

            return {
                SyncID: syncId,
                linkingPackage,
                mnemonic,
                linkedPeerOnlineServices,
            };
        } catch (error) {
            if (linkedPeerOnlineServices) {
                await rollbackRegisteredOnlineServicesDevice(
                    linkedPeerOnlineServices.DeviceId,
                );
            }
            addToProgressLog(
                errorMessage(error, "Failed to create link package."),
                "error",
            );
            throw error;
        }
    };

    const startLinkingProcess = async (
        cleanDeviceName: string,
        syncID: string,
        stunServers: VaultUtilTypes.STUNServerConfiguration[],
        turnServers: VaultUtilTypes.TURNServerConfiguration[],
        signalingServer: VaultUtilTypes.SignalingServerConfiguration | null,
        onlineServicesDeviceID: string | null,
        linkSecret: string,
    ) => {
        const webRTConnection = await Synchronization.initWebRTC(
            stunServers,
            turnServers,
            turnServers.length === 0 ? { syncId: syncID } : undefined,
        );
        const webRTCDataChannel = webRTConnection.createDataChannel("linking");
        let iceCandidatesGenerated = 0;

        const signalingServerConnection = Synchronization.initPusherInstance(
            signalingServer,
            syncID,
        );
        const channelName = constructLinkPresenceChannelName(syncID);
        const wsChannel = signalingServerConnection.subscribe(channelName);
        let signalingFailureReported = false;
        const signalingChannelReadyRef = { current: false };
        let signalingSetupTimeout: number | undefined;

        const clearSignalingSetupTimeout = () => {
            if (signalingSetupTimeout !== undefined) {
                window.clearTimeout(signalingSetupTimeout);
                signalingSetupTimeout = undefined;
            }
        };

        const teardownLinkingConnections = () => {
            clearSignalingSetupTimeout();
            webRTCDataChannel.close();
            webRTConnection.close();
            signalingServerConnection.disconnect();
        };

        const failActiveLinking = async () => {
            teardownLinkingConnections();
            await rollbackRegisteredOnlineServicesDevice(
                onlineServicesDeviceID,
            );
            applyLinkingOutcome("error");
        };

        const reportSignalingFailure = (message: string) => {
            if (
                signalingFailureReported ||
                vaultTransferSentRef.current ||
                webRTConnection.connectionState === "connected"
            ) {
                return;
            }

            signalingFailureReported = true;
            clearSignalingSetupTimeout();
            addToProgressLog(message, "error");
            toast.error(message);
            void failActiveLinking();
        };

        signalingSetupTimeout = window.setTimeout(() => {
            if (
                !signalingFailureReported &&
                !signalingChannelReadyRef.current
            ) {
                reportSignalingFailure(
                    "Timed out connecting to the signaling server.",
                );
            }
        }, 30_000);

        cancelFnRef.current = async () => {
            teardownLinkingConnections();
            await rollbackRegisteredOnlineServicesDevice(
                onlineServicesDeviceID,
            );
            applyLinkingOutcome("cancelled");
            addToProgressLog("Linking cancelled.", "error");
            toast.error("Linking cancelled.");
        };

        webRTConnection.onconnectionstatechange = () => {
            if (webRTConnection.connectionState === "connected") {
                addToProgressLog(
                    "Private connection established. Closing signaling...",
                    "info",
                );
                signalingServerConnection.disconnect();
                signalingServerConnection.unbind();
            } else if (
                webRTConnection.connectionState === "disconnected" ||
                webRTConnection.connectionState === "failed"
            ) {
                if (!vaultTransferSentRef.current) {
                    void failActiveLinking();
                }
            }
        };

        const remoteKeyBundleRef: {
            current: VaultUtilTypes.SyncKeyBundle | null;
        } = {
            current: null,
        };

        webRTCDataChannel.onmessage = async (event) => {
            try {
                const message = VaultUtilTypes.LinkReceiverKeyBundle.decode(
                    new Uint8Array(event.data),
                );
                if (!message.ReceiverKeyBundle) return;
                const senderBundle = requireLocalSyncKeyBundle(
                    unlockedVault.LinkedDevices,
                );
                const macValid = await verifyLinkMac(
                    linkSecret,
                    linkReceiverBundleMacBytes(
                        syncID,
                        senderBundle,
                        message.ReceiverKeyBundle,
                        message.Nonce,
                    ),
                    message.Mac,
                );
                if (macValid) {
                    remoteKeyBundleRef.current = message.ReceiverKeyBundle;
                    addToProgressLog(
                        "Receiver authenticated. Post-quantum sync key received.",
                        "done",
                    );
                }
            } catch {
                addToProgressLog("Ignored malformed link key message.", "warn");
            }
        };

        webRTCDataChannel.onopen = async () => {
            addToProgressLog(
                "Private channel open. Authenticating the receiving device...",
                "info",
            );

            if (!vaultMetadata || !unlockedVault) {
                addToProgressLog("Vault metadata is unavailable.", "error");
                void failActiveLinking();
                return;
            }

            const vaultSecret = getVaultDEKFromSession();
            if (vaultSecret.isErr()) {
                addToProgressLog(MISSING_VAULT_SECRET_ERROR, "error");
                void failActiveLinking();
                return;
            }

            let senderKeyBundle: VaultUtilTypes.SyncKeyBundle;
            try {
                senderKeyBundle = requireLocalSyncKeyBundle(
                    unlockedVault.LinkedDevices,
                );
            } catch (error) {
                const message = errorMessage(
                    error,
                    MISSING_SYNC_SIGNING_KEY_ERROR,
                );
                addToProgressLog(message, "error");
                toast.error(message);
                void failActiveLinking();
                return;
            }

            addToProgressLog(
                "Exchanging authenticated post-quantum sync keys...",
                "info",
            );
            const senderNonce = createNonce();
            const senderMac = await createLinkMac(
                linkSecret,
                linkSenderHelloMacBytes(syncID, senderKeyBundle, senderNonce),
            );
            webRTCDataChannel.send(
                new Uint8Array(
                    VaultUtilTypes.LinkSenderHello.encode({
                        Nonce: senderNonce,
                        Mac: senderMac,
                    }).finish(),
                ),
            );
            addToProgressLog(
                "Waiting for receiver to prove it knows the mnemonic...",
                "info",
            );

            const waitStartedAt = Date.now();
            while (
                !remoteKeyBundleRef.current &&
                Date.now() - waitStartedAt < 15_000
            ) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            const remoteKeyBundle = remoteKeyBundleRef.current;
            if (!remoteKeyBundle) {
                addToProgressLog(
                    "Timed out waiting for authenticated remote sync keys.",
                    "error",
                );
                void failActiveLinking();
                return;
            }
            addToProgressLog("Quantum-safe sync keys exchanged.", "done");

            addToProgressLog("Preparing vault package...", "info");
            const exportedVault = packageForLinking(
                unlockedVault,
                syncID,
                stunServers.map((server) => server.ID),
                turnServers.map((server) => server.ID),
                signalingServer?.ID ?? ONLINE_SERVICES_SELECTION_ID,
                senderKeyBundle.SyncSigningPublicKey,
                senderKeyBundle.SyncKemPublicKey,
            );

            const serializedVault =
                vaultMetadata.exportForLinking(exportedVault);
            addToProgressLog(
                "Encrypting vault for the authenticated receiver...",
                "info",
            );
            const { kemCiphertext, sharedSecret } = encapsulateSyncKem(
                remoteKeyBundle.SyncKemPublicKey,
            );
            const transferContext = linkVaultTransferContext(
                syncID,
                senderKeyBundle,
                remoteKeyBundle,
                kemCiphertext,
            );
            const transferKey = await deriveAeadKey(
                sharedSecret,
                transferContext,
            );
            const sealedVault = await sealAead(
                transferKey,
                new Uint8Array(serializedVault),
                transferContext,
            );
            addToProgressLog("Sending encrypted vault transfer...", "info");
            webRTCDataChannel.send(
                new Uint8Array(
                    VaultUtilTypes.LinkVaultTransfer.encode({
                        KemCiphertext: kemCiphertext,
                        Nonce: sealedVault.nonce,
                        Ciphertext: sealedVault.ciphertext,
                    }).finish(),
                ),
            );
            vaultTransferSentRef.current = true;
            addToProgressLog("Encrypted vault transfer sent.", "done");

            const saveLinkedDeviceResult = await persistVaultMutation(
                "vault.configuration",
                (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                    );
                    updatedVault.LinkedDevices = LinkedDevices.fromGeneric(
                        currentVault.LinkedDevices,
                    );
                    LinkedDevices.addLinkedDevice(
                        updatedVault.LinkedDevices,
                        cleanDeviceName,
                        syncID,
                        remoteKeyBundle.SyncSigningPublicKey,
                        remoteKeyBundle.SyncKemPublicKey,
                        stunServers.map((server) => server.ID),
                        turnServers.map((server) => server.ID),
                        signalingServer?.ID,
                    );
                    return { vault: updatedVault, result: undefined };
                },
            );
            if (saveLinkedDeviceResult.isErr()) {
                throw new Error("Failed to persist linked device.");
            }
            addToProgressLog("Linked device saved.");

            toast.success("Device linked.");
            addToProgressLog("Done. Safe to close this dialog.", "info");
            applyLinkingOutcome("success", { linkedName: cleanDeviceName });
        };

        webRTCDataChannel.onerror = () => {
            if (vaultTransferSentRef.current) {
                return;
            }
            addToProgressLog("Failed to send vault data.", "error");
            void failActiveLinking();
        };
        webRTCDataChannel.onclose = () => {
            if (vaultTransferSentRef.current) {
                webRTConnection.close();
                return;
            }
            webRTConnection.close();
            void failActiveLinking();
        };

        webRTConnection.onicecandidate = (event) => {
            if (event.candidate) {
                wsChannel.trigger("client-link", {
                    type: "ice-candidate",
                    data: event.candidate,
                });
                iceCandidatesGenerated++;
            }

            if (iceCandidatesGenerated === 0 && !event.candidate) {
                addToProgressLog("Failed to generate ICE candidates.", "error");
                void failActiveLinking();
            }
        };

        signalingServerConnection.connection.bind(
            "state_change",
            (state: {
                current:
                    | "initialized"
                    | "connecting"
                    | "connected"
                    | "unavailable"
                    | "disconnected"
                    | "failed";
            }) => {
                switch (state.current) {
                    case "connecting":
                        addToProgressLog(
                            "Connecting to signaling server...",
                            "info",
                        );
                        break;
                    case "connected":
                        addToProgressLog(
                            "Connected to signaling server.",
                            "info",
                        );
                        break;
                    case "failed":
                    case "unavailable":
                        reportSignalingFailure(
                            "Could not connect to the signaling server. Check your connection settings.",
                        );
                        break;
                    case "disconnected":
                        if (
                            webRTConnection.connectionState === "connected" ||
                            vaultTransferSentRef.current
                        ) {
                            break;
                        }
                        reportSignalingFailure(
                            "Lost connection to the signaling server before pairing completed.",
                        );
                        break;
                }
            },
        );

        signalingServerConnection.connection.bind("error", (error: unknown) => {
            signalingLog.error("Signaling error during device linking", {
                channelName,
                syncId: syncID,
                error,
            });
            reportSignalingFailure(
                "Error while setting up private connection.",
            );
        });

        wsChannel.bind("pusher:subscription_error", (status: unknown) => {
            signalingLog.error("Signaling channel subscription failed", {
                channelName,
                syncId: syncID,
                status,
            });
            reportSignalingFailure(
                "Failed to join the signaling channel. Check server credentials and network access.",
            );
        });

        wsChannel.bind("pusher:subscription_succeeded", () => {
            signalingChannelReadyRef.current = true;
            clearSignalingSetupTimeout();
            setReadyForOtherDevice(true);
            addToProgressLog("Waiting for other device...", "info");
        });

        wsChannel.bind("pusher:member_added", async () => {
            addToProgressLog("Other device found.");
            addToProgressLog("Creating private connection...", "info");
            const offer = await webRTConnection.createOffer();
            await webRTConnection.setLocalDescription(offer);
            wsChannel.trigger("client-link", {
                type: "offer",
                data: offer,
            });
        });

        wsChannel.bind(
            "client-link",
            async (data: {
                type: "ice-candidate" | "answer";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit;
            }) => {
                if (data.type === "ice-candidate") {
                    await webRTConnection.addIceCandidate(
                        data.data as RTCIceCandidateInit,
                    );
                } else if (data.type === "answer") {
                    await webRTConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit,
                    );
                }
            },
        );
    };

    const startLinking = async () => {
        setFormError("");

        const cleanDeviceName = deviceName.trim();
        if (!cleanDeviceName) {
            setFormError("Device name cannot be empty.");
            return;
        }
        if (cleanDeviceName.length > 150) {
            setFormError("Device name cannot be longer than 150 characters.");
            return;
        }
        if (onlineServicesIssue === "signin") {
            setFormError("Sign in to use Cryptex Online Services.");
            return;
        }
        if (onlineServicesIssue === "upgrade") {
            setFormError("Upgrade to use Cryptex Online Services for linking.");
            return;
        }
        if (onlineServicesIssue === "plan-sync") {
            setFormError(
                "Your subscription status is still updating. Refresh plan status and try again.",
            );
            return;
        }

        const signalingServer =
            unlockedVault.LinkedDevices.SignalingServers.find(
                (server) => server.ID === signalingServerID,
            );
        const stunServers = unlockedVault.LinkedDevices.STUNServers.filter(
            (server) => stunServerIDs.includes(server.ID),
        );
        const turnServers = unlockedVault.LinkedDevices.TURNServers.filter(
            (server) => turnServerIDs.includes(server.ID),
        );
        const usesOnlineServices =
            cloudServicesEnabled &&
            (signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
                stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
                turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID));

        setStage("linking");
        applyLinkingOutcome("in_progress");
        setMnemonicOpen(selectedLinkMethodRef.current === "file");
        setShowLogDetails(false);
        persistSendLinkPreferences();
        resetLinkingProgress();
        clearLinkTransferSecrets();

        let connectionPackage:
            | Awaited<ReturnType<typeof prepareConnectionPackage>>
            | undefined;

        try {
            connectionPackage = await prepareConnectionPackage(
                usesOnlineServices,
                rootDevice,
                stunServers,
                turnServers,
                signalingServer,
            );
            const packageBinary = connectionPackage.linkingPackage.toBinary();
            const packageBase64 = connectionPackage.linkingPackage.toBase64();
            setLinkingPackageBinary(packageBinary);
            setLinkingPackageBase64(packageBase64);

            if (selectedLinkMethodRef.current === "file") {
                downloadLinkingPackage(packageBinary, cleanDeviceName);
            }

            await startLinkingProcess(
                cleanDeviceName,
                connectionPackage.SyncID,
                stunServers,
                turnServers,
                signalingServer ?? null,
                // If Online Services is used, we need to know the device ID (if we need to rollback)
                connectionPackage.linkedPeerOnlineServices?.DeviceId ?? null,
                connectionPackage.mnemonic,
            );
        } catch (error) {
            const logLinkError = usesOnlineServices
                ? onlineServicesLog.error
                : vaultLog.error;
            logLinkError(
                usesOnlineServices
                    ? "Failed to link device with Online Services"
                    : "Failed to link device",
                {
                    linkMethod: selectedLinkMethodRef.current,
                    usesOnlineServices,
                    signalingServerId: signalingServerID,
                    stunServerCount: stunServers.length,
                    turnServerCount: turnServers.length,
                    error,
                },
            );
            const message = errorMessage(error, "Failed to link device.");
            setFormError(message);
            addToProgressLog(message, "error");
            toast.error(message);
            await rollbackRegisteredOnlineServicesDevice(
                connectionPackage?.linkedPeerOnlineServices?.DeviceId,
            );
            applyLinkingOutcome("error");
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && isLinkingActive) {
            void cancelFnRef.current();
        }
        onOpenChange(nextOpen);
    };

    const linkingStatusMessage = getSendLinkStatusMessage(
        progressLog,
        readyForOtherDevice,
        selectedLinkMethod,
    );

    const updateConnectionPreferences = (
        next: Partial<
            Pick<
                SendLinkPreferences,
                | "signalingServerID"
                | "stunServerIDs"
                | "turnServerIDs"
                | "rootDevice"
            >
        >,
    ) => {
        const nextPreferences: SendLinkPreferences = {
            linkMethod: selectedLinkMethodRef.current,
            signalingServerID: next.signalingServerID ?? signalingServerID,
            stunServerIDs: next.stunServerIDs ?? stunServerIDs,
            turnServerIDs: next.turnServerIDs ?? turnServerIDs,
            rootDevice: next.rootDevice ?? rootDevice,
        };

        if (next.signalingServerID !== undefined) {
            setSignalingServerID(next.signalingServerID);
        }
        if (next.stunServerIDs !== undefined) {
            setSTUNServerIDs(next.stunServerIDs);
        }
        if (next.turnServerIDs !== undefined) {
            setTURNServerIDs(next.turnServerIDs);
        }
        if (next.rootDevice !== undefined) {
            setRootDevice(next.rootDevice);
        }

        saveSendLinkPreferences(nextPreferences);
    };

    const handleRefreshPlanAccess = async () => {
        setPlanSyncPending(true);
        try {
            await syncOnlineServicesRemoteConfiguration();
            await refreshCheckoutTrpcCaches(trpcUtils);
            toast.success("Plan status refreshed.");
        } catch (error) {
            onlineServicesLog.error(
                "Failed to refresh plan access after checkout",
                {
                    error,
                },
            );
            toast.error("Could not refresh plan status.");
        } finally {
            setPlanSyncPending(false);
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent
                    className={cn(
                        "vault-settings-dialog grid max-h-[min(88vh,100dvh)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl",
                        stage === "linking" &&
                            linkingView === "success" &&
                            "border-emerald-500/50",
                    )}
                >
                    <DialogHeader className="vault-settings-header border-b px-4 py-4 sm:px-6">
                        <DialogTitle>{dialogTitle}</DialogTitle>
                        <DialogDescription className="sr-only">
                            Name the device, choose a transfer method, then
                            start linking.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 overflow-y-auto overscroll-contain">
                        <div className="space-y-5 p-4 sm:p-6">
                            {stage === "configure" ? (
                                <>
                                    <div className="space-y-2">
                                        <Label htmlFor="link-device-name">
                                            Device name
                                        </Label>
                                        <Input
                                            id="link-device-name"
                                            value={deviceName}
                                            onChange={(event) =>
                                                setDeviceName(
                                                    event.target.value,
                                                )
                                            }
                                            placeholder="Maya's laptop"
                                            autoFocus
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Transfer method</Label>
                                        <SendLinkMethodPicker
                                            value={selectedLinkMethod}
                                            onChange={selectLinkMethod}
                                        />
                                    </div>

                                    <Accordion
                                        type="single"
                                        collapsible
                                        value={advancedAccordion}
                                        onValueChange={setAdvancedAccordion}
                                    >
                                        <AccordionItem
                                            value="advanced"
                                            className="border-none"
                                        >
                                            <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline">
                                                Advanced connection
                                            </AccordionTrigger>
                                            <AccordionContent className="space-y-4">
                                                <div className="grid gap-3 sm:grid-cols-3">
                                                    <ServerSelect
                                                        label="Signaling"
                                                        value={
                                                            signalingServerID
                                                        }
                                                        onChange={(value) =>
                                                            updateConnectionPreferences(
                                                                {
                                                                    signalingServerID:
                                                                        value,
                                                                },
                                                            )
                                                        }
                                                        servers={
                                                            unlockedVault
                                                                .LinkedDevices
                                                                .SignalingServers
                                                        }
                                                    />
                                                    <ServerMultiSelect
                                                        label="STUN"
                                                        value={stunServerIDs}
                                                        onChange={(value) =>
                                                            updateConnectionPreferences(
                                                                {
                                                                    stunServerIDs:
                                                                        value,
                                                                },
                                                            )
                                                        }
                                                        servers={
                                                            unlockedVault
                                                                .LinkedDevices
                                                                .STUNServers
                                                        }
                                                    />
                                                    <ServerMultiSelect
                                                        label="TURN"
                                                        value={turnServerIDs}
                                                        onChange={(value) =>
                                                            updateConnectionPreferences(
                                                                {
                                                                    turnServerIDs:
                                                                        value,
                                                                },
                                                            )
                                                        }
                                                        servers={
                                                            unlockedVault
                                                                .LinkedDevices
                                                                .TURNServers
                                                        }
                                                    />
                                                </div>

                                                <label className="flex items-start gap-3 rounded-lg border p-3">
                                                    <Checkbox
                                                        checked={rootDevice}
                                                        onCheckedChange={(
                                                            checked,
                                                        ) =>
                                                            updateConnectionPreferences(
                                                                {
                                                                    rootDevice:
                                                                        checked ===
                                                                        true,
                                                                },
                                                            )
                                                        }
                                                        disabled={
                                                            !usesOnlineServicesSelection
                                                        }
                                                    />
                                                    <span className="text-sm font-medium">
                                                        Make linked device root
                                                    </span>
                                                </label>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>

                                    {onlineServicesIssue ? (
                                        <Alert variant="destructive">
                                            <ShieldCheck className="h-4 w-4" />
                                            <AlertTitle>
                                                Cryptex Online Services
                                            </AlertTitle>
                                            <AlertDescription className="space-y-3">
                                                <p>
                                                    Selected Online Services
                                                    entry needs account access
                                                    and paid-tier linking.
                                                </p>
                                                {onlineServicesIssue ===
                                                "signin" ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => {
                                                            handleOpenChange(
                                                                false,
                                                            );
                                                            onRequireOnlineServicesSignIn?.();
                                                        }}
                                                    >
                                                        Sign in
                                                    </Button>
                                                ) : null}
                                                {onlineServicesIssue ===
                                                "upgrade" ? (
                                                    <div className="space-y-3">
                                                        <CheckoutTierPicker
                                                            value={checkoutTier}
                                                            onChange={
                                                                setCheckoutTier
                                                            }
                                                            disabled={
                                                                checkoutOpen
                                                            }
                                                        />
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            onClick={() => {
                                                                setCheckoutOpen(
                                                                    true,
                                                                );
                                                            }}
                                                            disabled={
                                                                checkoutOpen ||
                                                                !!subscription?.nonFree
                                                            }
                                                        >
                                                            Upgrade
                                                        </Button>
                                                    </div>
                                                ) : null}
                                                {onlineServicesIssue ===
                                                "plan-sync" ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={
                                                            planSyncPending
                                                        }
                                                        onClick={() =>
                                                            void handleRefreshPlanAccess()
                                                        }
                                                    >
                                                        {planSyncPending
                                                            ? "Refreshing…"
                                                            : "Refresh plan status"}
                                                    </Button>
                                                ) : null}
                                            </AlertDescription>
                                        </Alert>
                                    ) : null}

                                    {formError ? (
                                        <p
                                            className="text-sm text-destructive"
                                            role="alert"
                                        >
                                            {formError}
                                        </p>
                                    ) : null}
                                </>
                            ) : (
                                <>
                                    {linkingView === "active" ? (
                                        <SendLinkActiveLinkingPanel
                                            statusMessage={linkingStatusMessage}
                                            linkMethod={selectedLinkMethod}
                                            linkingPackageBase64={
                                                linkingPackageBase64
                                            }
                                            linkingPackageBinary={
                                                linkingPackageBinary
                                            }
                                            mnemonic={mnemonic}
                                            mnemonicOpen={mnemonicOpen}
                                            onToggleMnemonic={() =>
                                                setMnemonicOpen((open) => !open)
                                            }
                                            onDownloadAgain={() =>
                                                downloadLinkingPackage(
                                                    linkingPackageBinary,
                                                )
                                            }
                                            progressLog={progressLog}
                                            showLogDetails={showLogDetails}
                                            onToggleLogDetails={() =>
                                                setShowLogDetails(
                                                    (open) => !open,
                                                )
                                            }
                                        />
                                    ) : (
                                        <SendLinkTerminalPanel
                                            variant={linkingView}
                                            linkedDeviceName={linkedDeviceName}
                                            errorMessage={getLatestLinkingErrorMessage(
                                                progressLog,
                                            )}
                                            progressLog={progressLog}
                                            showLogDetails={showLogDetails}
                                            onToggleLogDetails={() =>
                                                setShowLogDetails(
                                                    (open) => !open,
                                                )
                                            }
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="vault-settings-footer border-t px-4 py-4 sm:px-6">
                        {stage === "configure" ? (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => handleOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    disabled={!canStart}
                                    onClick={() => void startLinking()}
                                >
                                    Start linking
                                </Button>
                            </>
                        ) : linkingView === "success" ? (
                            <Button
                                type="button"
                                autoFocus
                                onClick={() => handleOpenChange(false)}
                            >
                                Close
                            </Button>
                        ) : linkingView === "cancelled" ||
                          linkingView === "error" ? (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={returnToConfigure}
                                >
                                    Start over
                                </Button>
                                <Button
                                    type="button"
                                    autoFocus
                                    onClick={() => handleOpenChange(false)}
                                >
                                    Close
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={!isLinkingActive}
                                    onClick={() => void cancelFnRef.current()}
                                >
                                    Cancel linking
                                </Button>
                                <Button
                                    type="button"
                                    disabled={isLinkingActive}
                                    onClick={() => handleOpenChange(false)}
                                >
                                    Close
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <EmbeddedCheckoutDialog
                open={checkoutOpen}
                onOpenChange={setCheckoutOpen}
                tier={checkoutTier}
                onComplete={() => {
                    checkoutFinalizeAbortRef.current?.abort();
                    const controller = new AbortController();
                    checkoutFinalizeAbortRef.current = controller;

                    void finalizeCheckoutCompletion({
                        signal: controller.signal,
                        onSynced: async () => {
                            await refreshCheckoutTrpcCaches(trpcUtils);
                        },
                    });
                }}
            />
        </>
    );
}

export type ReceiveLinkRequestDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    showWarningDialog: WarningDialogShowFn;
};

type ReceiveLinkMethod = "qr" | "file";
type ReceiveLinkStage = "input" | "linking" | "done" | "failed" | "aborted";
type ReceiveLinkStep = {
    id: LinkingProcessStep;
    title: string;
    description: string;
    status: LinkingProcessState;
};
type ReceiveMergeSummary = {
    credentialsAdded: number;
    credentialsSkipped: number;
    devicesAdded: number;
};

const receiveLinkStepCopy: Record<
    LinkingProcessStep,
    { title: string; description: string }
> = {
    [LinkingProcessStep.Signaling]: {
        title: "Connect",
        description: "Joining the secure linking room.",
    },
    [LinkingProcessStep.SignalingWaitingOtherDevice]: {
        title: "Find sender",
        description: "Waiting for the device sending this vault data.",
    },
    [LinkingProcessStep.DirectConnection]: {
        title: "Private channel",
        description: "Building encrypted peer-to-peer connection.",
    },
    [LinkingProcessStep.SyncKeyExchange]: {
        title: "Quantum-safe sync setup",
        description:
            "Sharing post-quantum keys used to verify future sync messages.",
    },
    [LinkingProcessStep.SignalingCleanup]: {
        title: "Drop relay",
        description: "Relay no longer needed after direct connection.",
    },
    [LinkingProcessStep.VaultTransfer]: {
        title: "Receive data",
        description: "Downloading vault data.",
    },
    [LinkingProcessStep.VaultSave]: {
        title: "Merge vault",
        description: "Adding missing items to current vault.",
    },
    [LinkingProcessStep.DirectConnectionCleanup]: {
        title: "Finish",
        description: "Closing private connection.",
    },
};

const createReceiveLinkSteps = (): ReceiveLinkStep[] =>
    Object.entries(receiveLinkStepCopy).map(([id, copy]) => ({
        id: Number(id) as LinkingProcessStep,
        title: copy.title,
        description: copy.description,
        status: LinkingProcessState.Pending,
    }));

const cloneCredential = (credential: VaultUtilTypes.Credential) => {
    const cloned = Object.assign(new VaultCredential(), credential);
    if (credential.TOTP) {
        cloned.TOTP = Object.assign(new TOTP(), credential.TOTP);
    }
    return cloned;
};

const cloneLinkedDevice = (device: VaultUtilTypes.LinkedDevice) =>
    LinkedDevices.fromGenericDevice(device);

const cloneSTUNServerConfig = (
    server: VaultUtilTypes.STUNServerConfiguration,
) => Object.assign(new STUNServerConfiguration(), server);

const cloneTURNServerConfig = (
    server: VaultUtilTypes.TURNServerConfiguration,
) => Object.assign(new TURNServerConfiguration(), server);

const cloneSignalingServerConfig = (
    server: VaultUtilTypes.SignalingServerConfiguration,
) => Object.assign(new SignalingServerConfiguration(), server);

const cloneOnlineServices = (onlineServices: VaultUtilTypes.OnlineServices) =>
    new OnlineServices(
        onlineServices.DeviceId,
        onlineServices.UserID,
        onlineServices.PublicKeyJWK,
        onlineServices.PrivateKeyJWK,
    );

async function parseReceivedVault(data: Uint8Array) {
    const rawVault = VaultUtilTypes.Vault.decode(data);
    const receivedVault = Object.assign(new Vault(), rawVault);
    receivedVault.LinkedDevices = LinkedDevices.fromGeneric(
        receivedVault.LinkedDevices,
    );
    receivedVault.Credentials = receivedVault.Credentials.map(cloneCredential);
    receivedVault.Directories = receivedVault.Directories.map((directory) =>
        Object.assign(new Directory(), directory),
    );
    await receivedVault.upgrade();

    return receivedVault;
}

type ReceiveInputStep = "package" | "mnemonic";
type ReceiveLinkPhase = "connect" | "receive" | "merge";

const receiveLinkPhaseByStep: Record<LinkingProcessStep, ReceiveLinkPhase> = {
    [LinkingProcessStep.Signaling]: "connect",
    [LinkingProcessStep.SignalingWaitingOtherDevice]: "connect",
    [LinkingProcessStep.DirectConnection]: "connect",
    [LinkingProcessStep.SyncKeyExchange]: "receive",
    [LinkingProcessStep.SignalingCleanup]: "receive",
    [LinkingProcessStep.VaultTransfer]: "receive",
    [LinkingProcessStep.VaultSave]: "merge",
    [LinkingProcessStep.DirectConnectionCleanup]: "merge",
};

const receiveLinkPhaseDefaultMessage: Record<ReceiveLinkPhase, string> = {
    connect: "Connecting to sending device...",
    receive: "Receiving encrypted vault...",
    merge: "Adding new items to your vault...",
};

const receiveLinkPhaseProgress: Record<ReceiveLinkPhase, number> = {
    connect: 33,
    receive: 66,
    merge: 100,
};

const getReceiveLinkPhase = (steps: ReceiveLinkStep[]): ReceiveLinkPhase => {
    const active = steps.find(
        (step) => step.status === LinkingProcessState.Active,
    );
    if (active) return receiveLinkPhaseByStep[active.id];

    const latestCompleted = [...steps]
        .reverse()
        .find((step) => step.status === LinkingProcessState.Completed);
    if (latestCompleted) return receiveLinkPhaseByStep[latestCompleted.id];

    return "connect";
};

const getReceiveLinkStatusMessage = (
    steps: ReceiveLinkStep[],
    progressLog: ProgressLogType[],
): string => {
    const latest = progressLog[0];
    if (latest && latest.type !== "error") return latest.message;

    return receiveLinkPhaseDefaultMessage[getReceiveLinkPhase(steps)];
};

const getLatestReceiveErrorMessage = (
    progressLog: ProgressLogType[],
): string => {
    const latest = progressLog.find((entry) => entry.type === "error");
    return latest?.message ?? "Linking failed.";
};

const getReceiveLinkDialogTitle = (stage: ReceiveLinkStage): string => {
    if (stage === "done") return "Vault data merged";
    if (stage === "aborted") return "Linking aborted";
    if (stage === "failed") return "Linking failed";
    if (stage === "linking") return "Receiving vault data";
    return "Receive vault data";
};

const hasReceiveLinkPackage = (
    method: ReceiveLinkMethod,
    qrCodeData: string,
    linkFile: File | null,
) => (method === "file" ? !!linkFile : !!qrCodeData.trim());

const RECEIVE_LINK_PACKAGE_PARSE_SUMMARY =
    "This link package could not be read.";
const RECEIVE_LINK_PACKAGE_UNLOCK_SUMMARY =
    "The mnemonic does not unlock this link package.";

const receiveLinkErrorDetail = (error: unknown): string => {
    if (error == null) return "";
    if (typeof error === "string") return error.trim();
    if (error instanceof Error) return error.message.trim();
    try {
        return JSON.stringify(error).trim();
    } catch {
        return "Unknown link error";
    }
};

const formatReceiveLinkPackageError = (
    phase: "parse" | "unlock",
    error: unknown,
): string => {
    const summary =
        phase === "parse"
            ? RECEIVE_LINK_PACKAGE_PARSE_SUMMARY
            : RECEIVE_LINK_PACKAGE_UNLOCK_SUMMARY;
    const detail = receiveLinkErrorDetail(error);
    return detail ? `${summary} Details: ${detail}` : summary;
};

class ReceiveLinkPackageError extends Error {
    readonly phase: "parse" | "unlock";

    constructor(phase: "parse" | "unlock", cause: unknown) {
        super(formatReceiveLinkPackageError(phase, cause), { cause });
        this.name = "ReceiveLinkPackageError";
        this.phase = phase;
    }
}

function ReceiveInputStepIndicator({ step }: { step: ReceiveInputStep }) {
    const items: { id: ReceiveInputStep; label: string }[] = [
        { id: "package", label: "Link package" },
        { id: "mnemonic", label: "Mnemonic" },
    ];

    return (
        <div className="flex items-center gap-2 text-xs">
            {items.map((item, index) => {
                const isActive = item.id === step;
                const isComplete = step === "mnemonic" && item.id === "package";

                return (
                    <div key={item.id} className="flex items-center gap-2">
                        {index > 0 ? (
                            <ChevronRight
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                        ) : null}
                        <span
                            className={cn(
                                "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                                isActive && "border-primary bg-primary/10",
                                isComplete &&
                                    "border-emerald-500/50 bg-emerald-500/10",
                            )}
                        >
                            {isComplete ? (
                                <CheckCircle2
                                    className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                                    aria-hidden
                                />
                            ) : (
                                <span
                                    className={cn(
                                        "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium",
                                        isActive
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground",
                                    )}
                                >
                                    {index + 1}
                                </span>
                            )}
                            <span
                                className={cn(
                                    "font-medium",
                                    isActive
                                        ? "text-foreground"
                                        : "text-muted-foreground",
                                )}
                            >
                                {item.label}
                            </span>
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function ReceiveLinkTerminalPanel({
    variant,
    mergeSummary,
    errorMessage,
    progressLog,
    showLogDetails,
    onToggleLogDetails,
}: {
    variant: "success" | "aborted" | "failed";
    mergeSummary: ReceiveMergeSummary | null;
    errorMessage?: string;
    progressLog: ProgressLogType[];
    showLogDetails: boolean;
    onToggleLogDetails: () => void;
}) {
    const isSuccess = variant === "success";
    const isError = variant === "failed";

    return (
        <>
            <div
                className={cn(
                    "flex flex-col items-center justify-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm",
                    isSuccess
                        ? "min-h-48 border-emerald-500/50"
                        : isError
                          ? "min-h-40 border-destructive/40"
                          : "min-h-40",
                )}
            >
                {isSuccess ? (
                    <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                ) : isError ? (
                    <AlertCircle className="h-10 w-10 text-destructive" />
                ) : (
                    <AlertCircle className="h-10 w-10 text-amber-500" />
                )}
                <div className="space-y-1">
                    <p className="text-lg font-semibold text-foreground">
                        {isSuccess
                            ? "Vault data merged"
                            : isError
                              ? "Linking failed"
                              : "Linking aborted"}
                    </p>
                    {isSuccess && mergeSummary ? (
                        <>
                            <p className="text-sm text-muted-foreground">
                                {mergeSummary.credentialsAdded} credential
                                {mergeSummary.credentialsAdded === 1
                                    ? ""
                                    : "s"}{" "}
                                added.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {mergeSummary.credentialsSkipped} existing
                                credentials unchanged.
                            </p>
                        </>
                    ) : isError ? (
                        <>
                            <p className="text-sm text-destructive">
                                {errorMessage}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Try again with a fresh link package and
                                mnemonic.
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Linking was cancelled before vault data arrived.
                        </p>
                    )}
                </div>
            </div>

            <SendLinkLogToggle
                open={showLogDetails}
                onToggle={onToggleLogDetails}
                openLabel={isSuccess ? "Hide what happened" : "Hide details"}
                closedLabel={isSuccess ? "What happened?" : "Show details"}
                entries={progressLog}
            />
        </>
    );
}

function ReceiveLinkActiveLinkingPanel({
    statusMessage,
    phaseProgress,
    progressLog,
    showLogDetails,
    onToggleLogDetails,
}: {
    statusMessage: string;
    phaseProgress: number;
    progressLog: ProgressLogType[];
    showLogDetails: boolean;
    onToggleLogDetails: () => void;
}) {
    return (
        <>
            <div className="space-y-3 rounded-xl border bg-muted/10 p-4">
                <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">
                        {statusMessage}
                    </span>
                </div>
                <Progress value={phaseProgress} />
            </div>

            <SendLinkLogToggle
                open={showLogDetails}
                onToggle={onToggleLogDetails}
                openLabel="Hide details"
                closedLabel="Show details"
                entries={progressLog}
            />
        </>
    );
}

export function ReceiveLinkRequestDialog({
    open,
    onOpenChange,
    showWarningDialog,
}: ReceiveLinkRequestDialogProps) {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const [stage, setStage] = useState<ReceiveLinkStage>("input");
    const [inputStep, setInputStep] = useState<ReceiveInputStep>("package");
    const [method, setMethod] = useState<ReceiveLinkMethod>("qr");
    const [secret, setSecret] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    const [showPasteQR, setShowPasteQR] = useState(false);
    const [showLogDetails, setShowLogDetails] = useState(false);
    const [qrCodeData, setQRCodeData] = useState("");
    const [linkFile, setLinkFile] = useState<File | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [qrChunkProgress, setQrChunkProgress] =
        useState<ChunkedQRCodeProgress | null>(null);
    const [cameraError, setCameraError] = useState("");
    const [formError, setFormError] = useState("");
    const [steps, setSteps] = useState<ReceiveLinkStep[]>(
        createReceiveLinkSteps,
    );
    const [progressLog, setProgressLog] = useState<ProgressLogType[]>([]);
    const [mergeSummary, setMergeSummary] =
        useState<ReceiveMergeSummary | null>(null);

    const progressLogRef = useRef<ProgressLogType[]>([]);
    const completedRef = useRef(false);
    const failedRef = useRef(false);
    const abortedRef = useRef(false);
    const controllerRef = useRef<LinkingProcessController | null>(null);

    const canAbortWaitingForDevice =
        stage === "linking" &&
        steps.some(
            (step) =>
                step.id === LinkingProcessStep.SignalingWaitingOtherDevice &&
                step.status === LinkingProcessState.Active,
        );

    const addReceiveLog = (
        message: string,
        type: ProgressLogType["type"] = "info",
    ) => {
        const next = [{ message, type }, ...progressLogRef.current];
        progressLogRef.current = next;
        setProgressLog(next);
    };

    const reset = () => {
        setStage("input");
        setInputStep("package");
        setMethod("qr");
        setSecret("");
        setShowSecret(false);
        setShowPasteQR(false);
        setShowLogDetails(false);
        setQRCodeData("");
        setLinkFile(null);
        setIsScanning(false);
        setQrChunkProgress(null);
        setCameraError("");
        setFormError("");
        setSteps(createReceiveLinkSteps());
        setProgressLog([]);
        progressLogRef.current = [];
        setMergeSummary(null);
        completedRef.current = false;
        failedRef.current = false;
        abortedRef.current = false;
        controllerRef.current = null;
    };

    useEffect(() => {
        if (open) reset();
    }, [open]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && stage === "linking") {
            toast.info("Linking is in progress. Wait for it to finish.");
            return;
        }
        onOpenChange(nextOpen);
    };

    const readLinkFile = async () => {
        if (!linkFile) throw new Error("Choose a link file first.");

        return await new Promise<Uint8Array>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (!reader.result) {
                    reject(new Error("Failed to read link file."));
                    return;
                }
                resolve(new Uint8Array(reader.result as ArrayBuffer));
            };
            reader.onerror = () =>
                reject(new Error("Failed to read link file."));
            reader.readAsArrayBuffer(linkFile);
        });
    };

    const getLinkingPackage = async (): Promise<LinkingPackage> => {
        try {
            if (method === "file") {
                return LinkingPackage.fromBinary(await readLinkFile());
            }

            const parsed = LinkingPackage.fromBase64(qrCodeData.trim());
            if (parsed.isErr()) {
                throw new ReceiveLinkPackageError("parse", parsed.error);
            }
            return parsed.value;
        } catch (error) {
            if (error instanceof ReceiveLinkPackageError) throw error;
            throw new ReceiveLinkPackageError("parse", error);
        }
    };

    const confirmOnlineServicesOverwrite = (
        incomingOnlineServices: VaultUtilTypes.OnlineServices,
    ) =>
        new Promise<boolean>((resolve) => {
            showWarningDialog(
                `This link request contains Online Services credentials for a different user (${incomingOnlineServices.UserID}). Continuing will replace the Online Services credentials saved in this vault.`,
                () => resolve(true),
                () => resolve(false),
                "Overwrite credentials",
            );
        });

    const mergeReceivedVault = async (
        receivedVaultData: Uint8Array,
        onlineServicesOverwrite: OnlineServices | null,
        senderKeyBundle: VaultUtilTypes.SyncKeyBundle,
    ) => {
        const mutationResult = await persistVaultMutation(
            "link.merge",
            async (currentVault) => {
                const receivedVault =
                    await parseReceivedVault(receivedVaultData);
                const mergedVault = Object.assign(new Vault(), currentVault);
                mergedVault.Credentials =
                    currentVault.Credentials.map(cloneCredential);
                mergedVault.Directories = currentVault.Directories.map(
                    (directory) => Object.assign(new Directory(), directory),
                );
                mergedVault.LinkedDevices = LinkedDevices.fromGeneric(
                    currentVault.LinkedDevices,
                );
                if (onlineServicesOverwrite) {
                    mergedVault.OnlineServices = onlineServicesOverwrite;
                }

                let credentialsAdded = 0;
                let credentialsSkipped = 0;
                const existingCredentialIDs = new Set(
                    mergedVault.Credentials.map((credential) => credential.ID),
                );

                for (const credential of receivedVault.Credentials) {
                    if (
                        credential.Deleted ||
                        existingCredentialIDs.has(credential.ID)
                    ) {
                        credentialsSkipped++;
                        continue;
                    }

                    mergedVault.Credentials.push(cloneCredential(credential));
                    existingCredentialIDs.add(credential.ID);
                    credentialsAdded++;
                }

                const existingDirectoryIDs = new Set(
                    mergedVault.Directories.map((directory) => directory.ID),
                );
                for (const directory of receivedVault.Directories) {
                    if (existingDirectoryIDs.has(directory.ID)) continue;
                    mergedVault.Directories.push(
                        Object.assign(new Directory(), directory),
                    );
                    existingDirectoryIDs.add(directory.ID);
                }

                const addMissingByID = <T extends { ID: string }>(
                    current: T[],
                    incoming: T[],
                    clone: (item: T) => T,
                ) => {
                    const ids = new Set(current.map((item) => item.ID));
                    for (const item of incoming) {
                        if (ids.has(item.ID)) continue;
                        current.push(clone(item));
                        ids.add(item.ID);
                    }
                };

                addMissingByID(
                    mergedVault.LinkedDevices.STUNServers,
                    receivedVault.LinkedDevices.STUNServers,
                    cloneSTUNServerConfig,
                );
                addMissingByID(
                    mergedVault.LinkedDevices.TURNServers,
                    receivedVault.LinkedDevices.TURNServers,
                    cloneTURNServerConfig,
                );
                addMissingByID(
                    mergedVault.LinkedDevices.SignalingServers,
                    receivedVault.LinkedDevices.SignalingServers,
                    cloneSignalingServerConfig,
                );

                let devicesAdded = 0;
                const existingDeviceIDs = new Set(
                    mergedVault.LinkedDevices.Devices.map(
                        (device) => device.ID,
                    ),
                );
                const existingSyncIDs = new Set(
                    mergedVault.LinkedDevices.Devices.map(
                        (device) => device.SyncID,
                    ),
                );

                for (const device of receivedVault.LinkedDevices.Devices) {
                    if (
                        existingDeviceIDs.has(device.ID) ||
                        existingSyncIDs.has(device.SyncID)
                    ) {
                        continue;
                    }

                    const clonedDevice = cloneLinkedDevice(device);
                    clonedDevice.RemoteSyncPublicKey =
                        senderKeyBundle.SyncSigningPublicKey;
                    clonedDevice.RemoteSyncKemPublicKey =
                        senderKeyBundle.SyncKemPublicKey;
                    mergedVault.LinkedDevices.Devices.push(clonedDevice);
                    existingDeviceIDs.add(device.ID);
                    existingSyncIDs.add(device.SyncID);
                    devicesAdded++;
                }

                await ensureSyncSigningKeypair(mergedVault.LinkedDevices);
                await ensureSyncKemKeypair(mergedVault.LinkedDevices);

                const summary = {
                    credentialsAdded,
                    credentialsSkipped,
                    devicesAdded,
                };
                return { vault: mergedVault, result: summary };
            },
        );
        if (mutationResult.isErr()) {
            throw new Error(
                mutationResult.error === "VAULT_DEK_NOT_FOUND"
                    ? MISSING_VAULT_SECRET_ERROR
                    : "Failed to persist merged vault.",
            );
        }

        const summary = mutationResult.value;
        setMergeSummary(summary);
        addReceiveLog(
            `Merged ${summary.credentialsAdded} credentials and ${summary.devicesAdded} linked devices.`,
            "done",
        );
    };

    const updateStep = (status: LinkingProcessStatus) => {
        if (failedRef.current && status.State !== LinkingProcessState.Error) {
            return;
        }

        setSteps((currentSteps) =>
            currentSteps.map((step) =>
                step.id === status.Step
                    ? { ...step, status: status.State }
                    : step,
            ),
        );

        if (status.LogMessage) {
            addReceiveLog(
                status.LogMessage.message,
                status.LogMessage.type === "error" ? "error" : "info",
            );
        }

        if (status.State === LinkingProcessState.Error && !failedRef.current) {
            failedRef.current = true;
            setStage("failed");
            toast.error(status.LogMessage?.message ?? "Linking failed.");
        }
    };

    const abortWaitingForDevice = () => {
        if (!canAbortWaitingForDevice || !controllerRef.current) return;

        controllerRef.current.abortWaitingForDevice();
        controllerRef.current = null;
        abortedRef.current = true;
        setStage("aborted");
        addReceiveLog("Linking aborted.", "warn");
        toast.info("Linking aborted.");
    };

    const startReceiving = async () => {
        setFormError("");
        setCameraError("");
        setMergeSummary(null);

        if (secret.trim().length <= 1) {
            setFormError("Enter the mnemonic from the sending device.");
            return;
        }
        if (method === "qr" && !qrCodeData.trim()) {
            setFormError("Scan or paste the QR code data first.");
            return;
        }
        if (method === "file" && !linkFile) {
            setFormError("Choose the link file from the sending device.");
            return;
        }

        let receiveUsesOnlineServices = false;
        let receivedOnlineServicesDeviceId: string | null = null;
        let linkingStarted = false;

        try {
            const linkingPackage = await getLinkingPackage();
            let decryptedPackage;
            try {
                decryptedPackage = await linkingPackage.decryptPackage(
                    secret.trim(),
                );
            } catch (error) {
                if (error instanceof ReceiveLinkPackageError) throw error;
                throw new ReceiveLinkPackageError("unlock", error);
            }

            if (decryptedPackage.isErr()) {
                throw new ReceiveLinkPackageError(
                    "unlock",
                    decryptedPackage.error,
                );
            }

            const linkingBlob = decryptedPackage.value;
            // A link uses Online Services when the sender registered a peer
            // device with Online Services (OnlineServices field set) or when no
            // custom signaling server was encoded (online signaling selected).
            // The STUN/TURN server lists must NOT be part of this heuristic: a
            // TURN-only custom link legitimately has an empty STUN list (a TURN
            // server also fulfills the STUN role per RFC 8656).
            const usesOnlineServices =
                linkingBlob.OnlineServices != null ||
                linkingBlob.SignalingServer == null;
            if (
                !linkingBlob.SenderKeyBundle?.SyncSigningPublicKey ||
                !linkingBlob.SenderKeyBundle.SyncKemPublicKey
            ) {
                throw new Error(
                    "Link package is missing encrypted sync key material. Create a new link package and try again.",
                );
            }
            const senderKeyBundle = linkingBlob.SenderKeyBundle;
            receiveUsesOnlineServices = usesOnlineServices;
            receivedOnlineServicesDeviceId =
                linkingBlob.OnlineServices?.DeviceId ?? null;
            const onlineServicesOverwrite = linkingBlob.OnlineServices
                ? cloneOnlineServices(linkingBlob.OnlineServices)
                : null;

            if (
                linkingBlob.OnlineServices &&
                Vault.isOnlineServicesBound(unlockedVault) &&
                unlockedVault.OnlineServices.UserID !==
                    linkingBlob.OnlineServices.UserID
            ) {
                const confirmed = await confirmOnlineServicesOverwrite(
                    linkingBlob.OnlineServices,
                );

                if (!confirmed) {
                    const message = "Online Services overwrite cancelled.";
                    setFormError(message);
                    toast.info(message);
                    return;
                }
            }

            linkingStarted = true;
            setStage("linking");
            setShowLogDetails(false);
            setSteps(createReceiveLinkSteps());
            setProgressLog([]);
            progressLogRef.current = [];
            completedRef.current = false;
            failedRef.current = false;
            abortedRef.current = false;
            controllerRef.current = null;

            if (linkingBlob.OnlineServices) {
                setOnlineServicesData({
                    deviceId: linkingBlob.OnlineServices.DeviceId,
                    sessionToken: null,
                    sessionExpiresAt: null,
                    remoteData: null,
                });
                await establishPremiumSession({
                    deviceId: linkingBlob.OnlineServices.DeviceId,
                    privateKeyJWK: linkingBlob.OnlineServices.PrivateKeyJWK,
                });
                addReceiveLog(
                    "Online Services authentication applied.",
                    "done",
                );
            } else {
                clearOnlineServicesSession();
            }

            addReceiveLog("Link package unlocked.", "done");

            const syncKeyResult = await persistVaultMutation(
                "vault.configuration",
                async (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                    );
                    updatedVault.LinkedDevices = LinkedDevices.fromGeneric(
                        currentVault.LinkedDevices,
                    );
                    const generatedSigningKeys = await ensureSyncSigningKeypair(
                        updatedVault.LinkedDevices,
                    );
                    const generatedKemKeys = await ensureSyncKemKeypair(
                        updatedVault.LinkedDevices,
                    );
                    const syncKeys = {
                        signingPublicKey:
                            updatedVault.LinkedDevices.SyncSigningPublicKey,
                        signingPrivateKey:
                            updatedVault.LinkedDevices.SyncSigningPrivateKey,
                        kemPublicKey:
                            updatedVault.LinkedDevices.SyncKemPublicKey,
                        kemPrivateKey:
                            updatedVault.LinkedDevices.SyncKemPrivateKey,
                    };
                    return {
                        vault:
                            generatedSigningKeys || generatedKemKeys
                                ? updatedVault
                                : currentVault,
                        result: syncKeys,
                    };
                },
            );
            if (syncKeyResult.isErr()) {
                throw new Error("Failed to persist synchronization keys.");
            }

            const controllerResult = await LinkingProcessController.create(
                linkingBlob,
                usesOnlineServices,
                syncKeyResult.value,
                secret.trim(),
                async (status) => {
                    updateStep(status);

                    if (
                        status.Step === LinkingProcessStep.VaultTransfer &&
                        status.State === LinkingProcessState.Completed &&
                        status.VaultBinaryData
                    ) {
                        try {
                            await mergeReceivedVault(
                                status.VaultBinaryData,
                                onlineServicesOverwrite,
                                senderKeyBundle,
                            );
                        } catch (error) {
                            if (!failedRef.current) {
                                failedRef.current = true;
                                setStage("failed");
                                const message =
                                    error instanceof Error
                                        ? error.message
                                        : "Failed to merge received vault.";
                                addReceiveLog(message, "error");
                                toast.error(message);
                            }
                        }
                    }

                    if (
                        status.Step ===
                            LinkingProcessStep.DirectConnectionCleanup &&
                        status.State === LinkingProcessState.Completed &&
                        !completedRef.current
                    ) {
                        if (abortedRef.current || failedRef.current) return;
                        completedRef.current = true;
                        controllerRef.current = null;
                        setStage("done");
                        toast.success("Link received.");
                    }
                },
            );
            if (controllerResult.isErr()) {
                throw controllerResult.error;
            }
            controllerRef.current = controllerResult.value;
        } catch (error) {
            const logReceiveError = receiveUsesOnlineServices
                ? onlineServicesLog.error
                : vaultLog.error;
            logReceiveError(
                receiveUsesOnlineServices
                    ? "Failed to receive link request with Online Services"
                    : "Failed to receive link request",
                {
                    method,
                    onlineServicesDeviceId: receivedOnlineServicesDeviceId,
                    hasLinkFile: !!linkFile,
                    hasQRCodeData: !!qrCodeData.trim(),
                    error:
                        error instanceof ReceiveLinkPackageError
                            ? (error.cause ?? error)
                            : error,
                },
            );
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to receive link request.";
            setFormError(message);
            if (linkingStarted) {
                addReceiveLog(message, "error");
            }
            setStage("input");
            setInputStep(
                error instanceof ReceiveLinkPackageError &&
                    error.phase === "parse"
                    ? "package"
                    : "mnemonic",
            );
            toast.error(message);
        }
    };

    const hasLinkPackage = hasReceiveLinkPackage(method, qrCodeData, linkFile);
    const linkingStatusMessage = getReceiveLinkStatusMessage(
        steps,
        progressLog,
    );
    const linkingPhaseProgress =
        receiveLinkPhaseProgress[getReceiveLinkPhase(steps)];
    const dialogTitle = getReceiveLinkDialogTitle(stage);

    const proceedToMnemonicStep = () => {
        setFormError("");
        if (!hasLinkPackage) {
            setFormError(
                method === "file"
                    ? "Choose the link file from the sending device."
                    : "Scan or paste the QR code data first.",
            );
            return;
        }
        setInputStep("mnemonic");
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="vault-settings-dialog grid max-h-[min(88vh,100dvh)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg">
                <DialogHeader className="vault-settings-header border-b px-4 py-4 sm:px-6">
                    <DialogTitle>{dialogTitle}</DialogTitle>
                    {stage === "input" ? (
                        <DialogDescription>
                            Import a link package from the sending device.
                            Existing items stay; only missing data is added.
                        </DialogDescription>
                    ) : stage === "linking" ? (
                        <DialogDescription>
                            Keep this dialog open until linking completes.
                        </DialogDescription>
                    ) : null}
                </DialogHeader>

                <div className="min-h-0 overflow-y-auto overscroll-contain">
                    <div className="space-y-5 p-4 sm:p-6">
                        {stage === "input" ? (
                            <div className="space-y-5">
                                <ReceiveInputStepIndicator step={inputStep} />

                                {inputStep === "package" ? (
                                    <>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <button
                                                type="button"
                                                onClick={() => setMethod("qr")}
                                                className={cn(
                                                    "rounded-xl border p-4 text-left transition",
                                                    method === "qr" &&
                                                        "border-primary bg-primary/10",
                                                )}
                                            >
                                                <QrCode className="mb-3 h-5 w-5" />
                                                <span className="block text-sm font-medium">
                                                    Scan QR
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    Fastest when both devices
                                                    are nearby.
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setMethod("file")
                                                }
                                                className={cn(
                                                    "rounded-xl border p-4 text-left transition",
                                                    method === "file" &&
                                                        "border-primary bg-primary/10",
                                                )}
                                            >
                                                <FileText className="mb-3 h-5 w-5" />
                                                <span className="block text-sm font-medium">
                                                    Import file
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    Use a .{LINK_FILE_EXTENSION}{" "}
                                                    file from the sender.
                                                </span>
                                            </button>
                                        </div>

                                        {method === "qr" ? (
                                            <div className="space-y-3">
                                                <div className="overflow-hidden rounded-xl border bg-muted/20">
                                                    {isScanning &&
                                                    !qrCodeData ? (
                                                        <BarcodeScanner
                                                            onUpdate={(
                                                                _,
                                                                result,
                                                            ) => {
                                                                if (result) {
                                                                    setQRCodeData(
                                                                        result.getText(),
                                                                    );
                                                                    setQrChunkProgress(
                                                                        null,
                                                                    );
                                                                    setIsScanning(
                                                                        false,
                                                                    );
                                                                }
                                                            }}
                                                            onChunkProgress={
                                                                setQrChunkProgress
                                                            }
                                                            onError={(
                                                                error,
                                                            ) => {
                                                                uiLog.warn(
                                                                    "QR scanner error",
                                                                    { error },
                                                                );
                                                                setQrChunkProgress(
                                                                    null,
                                                                );
                                                                setCameraError(
                                                                    "Camera unavailable. Paste QR data instead.",
                                                                );
                                                                setShowPasteQR(
                                                                    true,
                                                                );
                                                                setIsScanning(
                                                                    false,
                                                                );
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
                                                            {hasLinkPackage ? (
                                                                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                                                            ) : (
                                                                <QrCode className="h-10 w-10 text-muted-foreground" />
                                                            )}
                                                            <div>
                                                                <p className="text-sm font-medium">
                                                                    {hasLinkPackage
                                                                        ? "Link package ready"
                                                                        : "Scan sender QR code"}
                                                                </p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {hasLinkPackage
                                                                        ? "Continue to enter the mnemonic."
                                                                        : "Camera scan fills package data automatically."}
                                                                </p>
                                                            </div>
                                                            {!hasLinkPackage ? (
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        setCameraError(
                                                                            "",
                                                                        );
                                                                        setQRCodeData(
                                                                            "",
                                                                        );
                                                                        setQrChunkProgress(
                                                                            null,
                                                                        );
                                                                        setIsScanning(
                                                                            true,
                                                                        );
                                                                    }}
                                                                >
                                                                    <Camera className="mr-2 h-4 w-4" />
                                                                    Start camera
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        setQRCodeData(
                                                                            "",
                                                                        );
                                                                        setQrChunkProgress(
                                                                            null,
                                                                        );
                                                                    }}
                                                                >
                                                                    <X className="mr-2 h-4 w-4" />
                                                                    Clear and
                                                                    rescan
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                {qrChunkProgress ? (
                                                    <div className="space-y-1.5">
                                                        <Progress
                                                            value={
                                                                (qrChunkProgress.received /
                                                                    qrChunkProgress.total) *
                                                                100
                                                            }
                                                        />
                                                        <p className="text-sm text-muted-foreground">
                                                            Scanned{" "}
                                                            {
                                                                qrChunkProgress.received
                                                            }{" "}
                                                            of{" "}
                                                            {
                                                                qrChunkProgress.total
                                                            }{" "}
                                                            QR parts. Keep
                                                            camera pointed at
                                                            sender.
                                                        </p>
                                                    </div>
                                                ) : null}
                                                {!showPasteQR &&
                                                !hasLinkPackage ? (
                                                    <Button
                                                        type="button"
                                                        variant="link"
                                                        size="sm"
                                                        className="h-auto px-0"
                                                        onClick={() =>
                                                            setShowPasteQR(true)
                                                        }
                                                    >
                                                        Can&apos;t scan? Paste
                                                        instead
                                                    </Button>
                                                ) : null}
                                                {showPasteQR ||
                                                hasLinkPackage ? (
                                                    <div className="space-y-2">
                                                        <Textarea
                                                            value={qrCodeData}
                                                            onChange={(event) =>
                                                                setQRCodeData(
                                                                    event.target
                                                                        .value,
                                                                )
                                                            }
                                                            placeholder="Paste QR code data here"
                                                            rows={3}
                                                        />
                                                        {qrCodeData ? (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setQRCodeData(
                                                                        "",
                                                                    );
                                                                    setQrChunkProgress(
                                                                        null,
                                                                    );
                                                                }}
                                                            >
                                                                <X className="mr-2 h-4 w-4" />
                                                                Clear QR data
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                                {cameraError ? (
                                                    <p className="text-sm text-destructive">
                                                        {cameraError}
                                                    </p>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <div
                                                className={cn(
                                                    "relative rounded-xl border border-dashed p-6 text-center transition",
                                                    linkFile
                                                        ? "border-emerald-500 bg-emerald-500/10"
                                                        : "bg-muted/20 hover:bg-muted/40",
                                                )}
                                                onDragOver={(event) =>
                                                    event.preventDefault()
                                                }
                                                onDrop={(event) => {
                                                    event.preventDefault();
                                                    const file = Array.from(
                                                        event.dataTransfer
                                                            .files,
                                                    ).find((item) =>
                                                        item.name.endsWith(
                                                            `.${LINK_FILE_EXTENSION}`,
                                                        ),
                                                    );
                                                    if (file) setLinkFile(file);
                                                }}
                                            >
                                                <input
                                                    type="file"
                                                    accept={`.${LINK_FILE_EXTENSION}`}
                                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                                    onChange={(event) =>
                                                        setLinkFile(
                                                            event.target
                                                                .files?.[0] ??
                                                                null,
                                                        )
                                                    }
                                                />
                                                <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                                                <p className="text-sm font-medium">
                                                    {linkFile
                                                        ? linkFile.name
                                                        : `Drop .${LINK_FILE_EXTENSION} file here`}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {linkFile
                                                        ? "Click or drop another file to replace it."
                                                        : "Click to browse if drag and drop is not available."}
                                                </p>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-sm text-muted-foreground">
                                            Enter the mnemonic shown on the
                                            sending device to unlock the link
                                            package.
                                        </p>
                                        <Label htmlFor="receive-link-secret">
                                            Mnemonic
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="receive-link-secret"
                                                type={
                                                    showSecret
                                                        ? "text"
                                                        : "password"
                                                }
                                                value={secret}
                                                onChange={(event) =>
                                                    setSecret(
                                                        event.target.value,
                                                    )
                                                }
                                                placeholder="Words shown on sending device"
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                        void startReceiving();
                                                    }
                                                }}
                                                className="pr-10"
                                                autoFocus
                                            />
                                            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() =>
                                                                    setShowSecret(
                                                                        !showSecret,
                                                                    )
                                                                }
                                                                className="h-7 w-7"
                                                                aria-label={
                                                                    showSecret
                                                                        ? "Hide mnemonic"
                                                                        : "Show mnemonic"
                                                                }
                                                            >
                                                                {showSecret ? (
                                                                    <EyeOff className="h-3.5 w-3.5" />
                                                                ) : (
                                                                    <Eye className="h-3.5 w-3.5" />
                                                                )}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {showSecret
                                                                ? "Hide"
                                                                : "Show"}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {formError ? (
                                    <p
                                        className="text-sm text-destructive"
                                        role="alert"
                                    >
                                        {formError}
                                    </p>
                                ) : null}
                            </div>
                        ) : stage === "linking" ? (
                            <ReceiveLinkActiveLinkingPanel
                                statusMessage={linkingStatusMessage}
                                phaseProgress={linkingPhaseProgress}
                                progressLog={progressLog}
                                showLogDetails={showLogDetails}
                                onToggleLogDetails={() =>
                                    setShowLogDetails((value) => !value)
                                }
                            />
                        ) : (
                            <ReceiveLinkTerminalPanel
                                variant={
                                    stage === "done"
                                        ? "success"
                                        : stage === "failed"
                                          ? "failed"
                                          : "aborted"
                                }
                                mergeSummary={mergeSummary}
                                errorMessage={getLatestReceiveErrorMessage(
                                    progressLog,
                                )}
                                progressLog={progressLog}
                                showLogDetails={showLogDetails}
                                onToggleLogDetails={() =>
                                    setShowLogDetails((value) => !value)
                                }
                            />
                        )}
                    </div>
                </div>

                <DialogFooter className="vault-settings-footer border-t px-4 py-4 sm:px-6">
                    {stage === "input" ? (
                        inputStep === "package" ? (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => handleOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    disabled={!hasLinkPackage}
                                    onClick={proceedToMnemonicStep}
                                >
                                    Next
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        setFormError("");
                                        setInputStep("package");
                                    }}
                                >
                                    Back
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => void startReceiving()}
                                >
                                    Receive vault data
                                </Button>
                            </>
                        )
                    ) : stage === "linking" ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!canAbortWaitingForDevice}
                            onClick={abortWaitingForDevice}
                            className="w-full sm:w-auto"
                        >
                            Cancel linking
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    reset();
                                }}
                            >
                                Try again
                            </Button>
                            <Button
                                type="button"
                                onClick={() => handleOpenChange(false)}
                            >
                                Close
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export type VaultSignalingConfig = {
    stunServers: STUNServerConfiguration[];
    turnServers: TURNServerConfiguration[];
    signalingServers: SignalingServerConfiguration[];
};

export type VaultSignalingConfigDialogProps = VaultSignalingConfig & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (config: VaultSignalingConfig) => Promise<void> | void;
};

type ServerKind = "stun" | "turn" | "signaling";

const cloneSTUNServer = (server: STUNServerConfiguration) =>
    Object.assign(new STUNServerConfiguration(), server);

const cloneTURNServer = (server: TURNServerConfiguration) =>
    Object.assign(new TURNServerConfiguration(), server);

const cloneSignalingServer = (server: SignalingServerConfiguration) =>
    Object.assign(new SignalingServerConfiguration(), server);

function countLabel(count: number, singular: string) {
    return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function EmptyServerState({ kind }: { kind: ServerKind }) {
    const labels: Record<ServerKind, string> = {
        stun: "No custom STUN servers. Vault uses Cryptex Online Services.",
        turn: "No custom TURN servers. Vault uses Cryptex Online Services.",
        signaling:
            "No custom signaling servers. Vault uses Cryptex Online Services.",
    };

    return (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            {labels[kind]}
        </div>
    );
}

function Field({
    id,
    label,
    value,
    onChange,
    placeholder,
    type = "text",
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
}) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">
                {label}
            </Label>
            <Input
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                type={type}
            />
        </div>
    );
}

export function VaultSignalingConfigDialog({
    open,
    onOpenChange,
    stunServers,
    turnServers,
    signalingServers,
    onSave,
}: VaultSignalingConfigDialogProps) {
    const [draftSTUNServers, setDraftSTUNServers] = useState<
        STUNServerConfiguration[]
    >([]);
    const [draftTURNServers, setDraftTURNServers] = useState<
        TURNServerConfiguration[]
    >([]);
    const [draftSignalingServers, setDraftSignalingServers] = useState<
        SignalingServerConfiguration[]
    >([]);
    const [error, setError] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!open) return;

        setDraftSTUNServers(stunServers.map(cloneSTUNServer));
        setDraftTURNServers(turnServers.map(cloneTURNServer));
        setDraftSignalingServers(signalingServers.map(cloneSignalingServer));
        setError("");
    }, [open, signalingServers, stunServers, turnServers]);

    const addSTUNServer = () => {
        setDraftSTUNServers((servers) => [
            ...servers,
            new STUNServerConfiguration("", ""),
        ]);
    };

    const addTURNServer = () => {
        setDraftTURNServers((servers) => [
            ...servers,
            new TURNServerConfiguration("", "", "", ""),
        ]);
    };

    const addSignalingServer = () => {
        setDraftSignalingServers((servers) => [
            ...servers,
            new SignalingServerConfiguration("", "", "", "", "", "6001", "0"),
        ]);
    };

    const save = async () => {
        setError("");

        const cleanSTUNServers = draftSTUNServers.map((server) =>
            Object.assign(cloneSTUNServer(server), {
                Name: server.Name.trim(),
                Host: server.Host.trim(),
            }),
        );
        const cleanTURNServers = draftTURNServers.map((server) =>
            Object.assign(cloneTURNServer(server), {
                Name: server.Name.trim(),
                Host: server.Host.trim(),
                Username: server.Username.trim(),
                Password: server.Password,
            }),
        );
        const cleanSignalingServers = draftSignalingServers.map((server) =>
            Object.assign(cloneSignalingServer(server), {
                Name: server.Name.trim(),
                AppID: server.AppID.trim(),
                Key: server.Key.trim(),
                Secret: server.Secret,
                Host: server.Host.trim(),
                ServicePort: server.ServicePort.trim(),
                SecureServicePort: server.SecureServicePort.trim(),
            }),
        );

        const missingSTUN = cleanSTUNServers.some(
            (server) => !server.Name || !server.Host,
        );
        const missingTURN = cleanTURNServers.some(
            (server) => !server.Name || !server.Host,
        );
        const missingSignaling = cleanSignalingServers.some(
            (server) =>
                !server.Name ||
                !server.AppID ||
                !server.Key ||
                !server.Secret ||
                !server.Host ||
                (!server.ServicePort && !server.SecureServicePort),
        );

        if (missingSTUN || missingTURN || missingSignaling) {
            setError(
                "Fill required fields or remove incomplete entries before saving.",
            );
            return;
        }

        setIsSaving(true);
        try {
            await onSave({
                stunServers: cleanSTUNServers,
                turnServers: cleanTURNServers,
                signalingServers: cleanSignalingServers,
            });
            onOpenChange(false);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to save signaling configuration.",
            );
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Vault signaling</DialogTitle>
                    <DialogDescription>
                        Configure custom signaling, STUN, and TURN servers for
                        device linking and synchronization. Leave sections empty
                        to use Cryptex Online Services.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="stun" className="space-y-4">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="stun">STUN</TabsTrigger>
                        <TabsTrigger value="turn">TURN</TabsTrigger>
                        <TabsTrigger value="signaling">Signaling</TabsTrigger>
                    </TabsList>

                    <TabsContent value="stun" className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">
                                {countLabel(draftSTUNServers.length, "server")}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addSTUNServer}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add STUN
                            </Button>
                        </div>
                        {draftSTUNServers.length === 0 ? (
                            <EmptyServerState kind="stun" />
                        ) : (
                            <div className="space-y-3">
                                {draftSTUNServers.map((server, index) => (
                                    <div
                                        key={server.ID}
                                        className="rounded-lg border border-border p-3"
                                    >
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <p className="text-sm font-medium">
                                                STUN server {index + 1}
                                            </p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                onClick={() =>
                                                    setDraftSTUNServers(
                                                        (servers) =>
                                                            servers.filter(
                                                                (item) =>
                                                                    item.ID !==
                                                                    server.ID,
                                                            ),
                                                    )
                                                }
                                                aria-label="Remove STUN server"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field
                                                id={`stun-name-${server.ID}`}
                                                label="Name"
                                                value={server.Name}
                                                placeholder="Home STUN"
                                                onChange={(value) =>
                                                    setDraftSTUNServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSTUNServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Name: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`stun-host-${server.ID}`}
                                                label="Host"
                                                value={server.Host}
                                                placeholder="stun.example.com:3478"
                                                onChange={(value) =>
                                                    setDraftSTUNServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSTUNServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Host: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="turn" className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">
                                {countLabel(draftTURNServers.length, "server")}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addTURNServer}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add TURN
                            </Button>
                        </div>
                        {draftTURNServers.length === 0 ? (
                            <EmptyServerState kind="turn" />
                        ) : (
                            <div className="space-y-3">
                                {draftTURNServers.map((server, index) => (
                                    <div
                                        key={server.ID}
                                        className="rounded-lg border border-border p-3"
                                    >
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <p className="text-sm font-medium">
                                                TURN server {index + 1}
                                            </p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                onClick={() =>
                                                    setDraftTURNServers(
                                                        (servers) =>
                                                            servers.filter(
                                                                (item) =>
                                                                    item.ID !==
                                                                    server.ID,
                                                            ),
                                                    )
                                                }
                                                aria-label="Remove TURN server"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field
                                                id={`turn-name-${server.ID}`}
                                                label="Name"
                                                value={server.Name}
                                                placeholder="Home TURN"
                                                onChange={(value) =>
                                                    setDraftTURNServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneTURNServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Name: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`turn-host-${server.ID}`}
                                                label="Host"
                                                value={server.Host}
                                                placeholder="turn.example.com:3478"
                                                onChange={(value) =>
                                                    setDraftTURNServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneTURNServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Host: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`turn-username-${server.ID}`}
                                                label="Username"
                                                value={server.Username}
                                                placeholder="turn-user"
                                                onChange={(value) =>
                                                    setDraftTURNServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneTURNServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Username:
                                                                                      value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`turn-password-${server.ID}`}
                                                label="Password"
                                                value={server.Password}
                                                placeholder="TURN credential"
                                                type="password"
                                                onChange={(value) =>
                                                    setDraftTURNServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneTURNServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Password:
                                                                                      value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="signaling" className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">
                                {countLabel(
                                    draftSignalingServers.length,
                                    "server",
                                )}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addSignalingServer}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add signaling
                            </Button>
                        </div>
                        {draftSignalingServers.length === 0 ? (
                            <EmptyServerState kind="signaling" />
                        ) : (
                            <div className="space-y-3">
                                {draftSignalingServers.map((server, index) => (
                                    <div
                                        key={server.ID}
                                        className="rounded-lg border border-border p-3"
                                    >
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <p className="text-sm font-medium">
                                                Signaling server {index + 1}
                                            </p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                onClick={() =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.filter(
                                                                (item) =>
                                                                    item.ID !==
                                                                    server.ID,
                                                            ),
                                                    )
                                                }
                                                aria-label="Remove signaling server"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field
                                                id={`signaling-name-${server.ID}`}
                                                label="Name"
                                                value={server.Name}
                                                placeholder="Home signaling"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Name: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`signaling-host-${server.ID}`}
                                                label="Host"
                                                value={server.Host}
                                                placeholder="signal.example.com"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Host: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`signaling-app-id-${server.ID}`}
                                                label="App ID"
                                                value={server.AppID}
                                                placeholder="app-id"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  AppID: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`signaling-key-${server.ID}`}
                                                label="Key"
                                                value={server.Key}
                                                placeholder="pusher-key"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Key: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`signaling-secret-${server.ID}`}
                                                label="Secret"
                                                value={server.Secret}
                                                placeholder="pusher-secret"
                                                type="password"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  Secret: value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`signaling-service-port-${server.ID}`}
                                                label="WS port"
                                                value={server.ServicePort}
                                                placeholder="6001"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  ServicePort:
                                                                                      value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                            <Field
                                                id={`signaling-secure-port-${server.ID}`}
                                                label="WSS port"
                                                value={server.SecureServicePort}
                                                placeholder="443, or 0 to disable"
                                                onChange={(value) =>
                                                    setDraftSignalingServers(
                                                        (servers) =>
                                                            servers.map(
                                                                (item) =>
                                                                    item.ID ===
                                                                    server.ID
                                                                        ? Object.assign(
                                                                              cloneSignalingServer(
                                                                                  item,
                                                                              ),
                                                                              {
                                                                                  SecureServicePort:
                                                                                      value,
                                                                              },
                                                                          )
                                                                        : item,
                                                            ),
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                {error ? (
                    <p className="text-sm text-destructive" role="alert">
                        {error}
                    </p>
                ) : null}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSaving}
                    >
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save configuration"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
