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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
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
    Group,
    LinkedDevices,
    OnlineServices,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TOTP,
    TURNServerConfiguration,
    Vault,
    VaultCredential,
    packageForLinking,
} from "@/app_lib/vault-utils/vault";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import {
    LinkingPackage,
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStatus,
    LinkingProcessStep,
} from "@/app_lib/vault-utils/linking";
import {
    generateKeyPair,
    privateKeyJwkToString,
    publicKeyJwkToString,
} from "@/app_lib/vault-utils/passkey";
import {
    encapsulateSyncKem,
    ensureSyncKemKeypair,
} from "@/app_lib/vault-utils/post-quantum-kem";
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
} from "@/app_lib/vault-utils/sync-crypto";
import { ensureSyncSigningKeypair } from "@/app_lib/vault-utils/sync-signing";
import * as Synchronization from "@/app_lib/synchronization";
import {
    constructLinkPresenceChannelName,
    navigateToCheckout,
} from "@/app_lib/online-services";
import { establishPremiumSession } from "@/app_lib/auth-session";
import {
    getVaultDEKFromSession,
    MISSING_VAULT_SECRET_ERROR,
} from "@/utils/vault-session";
import {
    clearOnlineServicesSession,
    linkedDevicesAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
} from "@/utils/atoms";
import {
    LINK_FILE_EXTENSION,
    ONLINE_SERVICES_SELECTION_ID,
} from "@/utils/consts";
import {
    onlineServicesLog,
    signalingLog,
    uiLog,
    vaultLog,
} from "@/utils/logging";
import { trpcReact } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import {
    createChunkedQRCodeFrames,
    DEFAULT_CHUNKED_QR_CHARS,
    DEFAULT_CHUNKED_QR_CYCLE_MS,
    type ChunkedQRCodeProgress,
} from "@ui/lib/chunked-qr";
import { TRPCClientError } from "@trpc/client";
import { useAtomValue, useSetAtom } from "jotai/react";
import {
    AlertCircle,
    Camera,
    CheckCircle2,
    Download,
    Eye,
    EyeOff,
    FileText,
    Loader2,
    Plus,
    QrCode,
    ShieldCheck,
    Trash2,
    Upload,
    Volume2,
    X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ulid } from "ulidx";
import BarcodeScanner from "@/components/general/qr-scanner";
import type { WarningDialogShowFn } from "@/components/dialog/warning";

export type SendLinkRequestDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRequireOnlineServicesSignIn?: () => void;
};

type LinkMethod = "qr" | "file" | "sound";
type LinkStage = "configure" | "linking";
type ProgressLogType = {
    message: string;
    type: "done" | "info" | "warn" | "error";
};

const DynamicQRCode = dynamic(() => import("react-qr-code"), { ssr: false });
const MISSING_SYNC_SIGNING_KEY_ERROR =
    "Vault sync keys are missing. Lock and unlock the vault, then try linking again.";

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

const linkMethodCopy: Record<
    LinkMethod,
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
    sound: {
        title: "Sound",
        description: "Coming soon.",
        icon: Volume2,
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
                    <DynamicQRCode value={frameValue} size={220} />
                ) : (
                    <span className="flex h-[220px] w-[220px] items-center justify-center text-xs text-muted-foreground">
                        {frameError || "Preparing QR chunks..."}
                    </span>
                )}
            </span>
            {frames.length > 1 ? (
                <span className="text-xs text-muted-foreground">
                    Part {activeFrameIndex + 1} of {frames.length}
                </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
                {copied ? "Copied" : "Click QR to copy payload"}
            </span>
        </button>
    );
}

function PqcKeyExchangeStep({ status }: { status: LinkingProcessState }) {
    const stateCopy: Record<LinkingProcessState, string> = {
        [LinkingProcessState.Pending]: "Waiting for private channel",
        [LinkingProcessState.Active]: "Sharing post-quantum sync keys",
        [LinkingProcessState.Completed]: "Quantum-safe sync keys ready",
        [LinkingProcessState.Error]: "Quantum-safe sync setup failed",
        [LinkingProcessState.Warning]: "Quantum-safe sync setup warning",
    };

    const icon =
        status === LinkingProcessState.Completed ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        ) : status === LinkingProcessState.Active ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : status === LinkingProcessState.Error ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        );

    return (
        <div className="flex gap-3 rounded-xl border p-4">
            <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                {icon}
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-medium">
                    Quantum-safe sync setup
                </span>
                <span className="block text-xs text-muted-foreground">
                    {stateCopy[status]}
                </span>
            </span>
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
                        <span className={cn("mt-0.5", colors[entry.type])}>
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
    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ONLINE_SERVICES_SELECTION_ID}>
                        Cryptex Online Services
                    </SelectItem>
                    {servers.map((server) => (
                        <SelectItem key={server.ID} value={server.ID}>
                            {server.Name || server.Host || "Unnamed server"}
                        </SelectItem>
                    ))}
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
    const selectedServers = servers.filter((server) =>
        value.includes(server.ID),
    );
    const usesOnlineServices = value.includes(ONLINE_SERVICES_SELECTION_ID);
    const selectedLabel = usesOnlineServices
        ? "Cryptex Online Services"
        : selectedServers.length === 1
          ? selectedServers[0]?.Name ||
            selectedServers[0]?.Host ||
            "Unnamed server"
          : selectedServers.length > 1
            ? `${selectedServers.length} servers selected`
            : "Cryptex Online Services";

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
                : [ONLINE_SERVICES_SELECTION_ID],
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
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

export function SendLinkRequestDialog({
    open,
    onOpenChange,
    onRequireOnlineServicesSignIn,
}: SendLinkRequestDialogProps) {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const { mutateAsync: linkNewDevice } =
        trpcReact.v1.device.link.useMutation();
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
        useState<LinkMethod>("qr");
    const [isOperationInProgress, setIsOperationInProgress] = useState(false);
    const [readyForOtherDevice, setReadyForOtherDevice] = useState(false);
    const [progressLog, setProgressLog] = useState<ProgressLogType[]>([]);
    const [syncKeyExchangeStatus, setSyncKeyExchangeStatus] =
        useState<LinkingProcessState>(LinkingProcessState.Pending);
    const [mnemonic, setMnemonic] = useState("");
    const [linkingPackageBase64, setLinkingPackageBase64] = useState("");
    const [linkingPackageBinary, setLinkingPackageBinary] =
        useState<Uint8Array | null>(null);
    const [formError, setFormError] = useState("");

    const progressLogRef = useRef<ProgressLogType[]>([]);
    const selectedLinkMethodRef = useRef<LinkMethod>("qr");
    const vaultTransferSentRef = useRef(false);
    const cancelFnRef = useRef<() => Promise<void> | void>(() => {
        // No active linking attempt.
    });

    const isSignedIn = Vault.isOnlineServicesBound(unlockedVault);
    const tierAllowsLinkingWithOnlineServices =
        isSignedIn && !!onlineServicesData?.remoteData?.canLink;
    const usesOnlineServicesSelection =
        signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
        stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
        turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID);

    const onlineServicesIssue =
        usesOnlineServicesSelection && !isSignedIn
            ? "signin"
            : usesOnlineServicesSelection &&
                !tierAllowsLinkingWithOnlineServices
              ? "upgrade"
              : null;
    const canStart =
        deviceName.trim().length > 0 &&
        deviceName.trim().length <= 150 &&
        onlineServicesIssue == null;

    const addToProgressLog = (
        message: string,
        type: ProgressLogType["type"] = "done",
    ) => {
        const newProgressLog = [{ message, type }, ...progressLogRef.current];
        progressLogRef.current = newProgressLog;
        setProgressLog(newProgressLog);
    };

    const resetDialog = () => {
        setStage("configure");
        setDeviceName("My Device");
        setSignalingServerID(ONLINE_SERVICES_SELECTION_ID);
        setSTUNServerIDs([ONLINE_SERVICES_SELECTION_ID]);
        setTURNServerIDs([ONLINE_SERVICES_SELECTION_ID]);
        setRootDevice(false);
        setSelectedLinkMethod("qr");
        selectedLinkMethodRef.current = "qr";
        setIsOperationInProgress(false);
        setReadyForOtherDevice(false);
        setProgressLog([]);
        progressLogRef.current = [];
        vaultTransferSentRef.current = false;
        setSyncKeyExchangeStatus(LinkingProcessState.Pending);
        setMnemonic("");
        setLinkingPackageBase64("");
        setLinkingPackageBinary(null);
        setFormError("");
        cancelFnRef.current = () => {
            // No active linking attempt.
        };
    };

    useEffect(() => {
        if (open) resetDialog();
    }, [open]);

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

    const selectLinkMethod = (method: LinkMethod) => {
        if (method === "sound") return;

        selectedLinkMethodRef.current = method;
        setSelectedLinkMethod(method);
        if (method === "file") {
            downloadLinkingPackage(linkingPackageBinary);
        }
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

        const stopLinking = () => {
            webRTCDataChannel.close();
            webRTConnection.close();
            signalingServerConnection.disconnect();
            setIsOperationInProgress(false);
            setReadyForOtherDevice(false);
        };

        cancelFnRef.current = async () => {
            signalingServerConnection.disconnect();
            webRTCDataChannel.close();
            webRTConnection.close();
            setIsOperationInProgress(false);
            setReadyForOtherDevice(false);

            if (onlineServicesDeviceID) {
                addToProgressLog("Rollback - cleaning registration...", "info");
                try {
                    await removeDevice.mutateAsync({
                        id: onlineServicesDeviceID,
                    });
                    addToProgressLog("Rollback complete.", "info");
                } catch (error) {
                    onlineServicesLog.error(
                        "Failed to remove linked device during rollback",
                        {
                            deviceId: onlineServicesDeviceID,
                            error,
                        },
                    );
                    addToProgressLog(
                        "Rollback failed. Remove device manually.",
                        "error",
                    );
                }
            }

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
                setIsOperationInProgress(false);
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
                setSyncKeyExchangeStatus(LinkingProcessState.Error);
                stopLinking();
                return;
            }

            const vaultSecret = getVaultDEKFromSession();
            if (vaultSecret.isErr()) {
                addToProgressLog(MISSING_VAULT_SECRET_ERROR, "error");
                setIsOperationInProgress(false);
                setSyncKeyExchangeStatus(LinkingProcessState.Error);
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
                setSyncKeyExchangeStatus(LinkingProcessState.Error);
                stopLinking();
                return;
            }

            setSyncKeyExchangeStatus(LinkingProcessState.Active);
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
                setSyncKeyExchangeStatus(LinkingProcessState.Error);
                stopLinking();
                return;
            }
            setSyncKeyExchangeStatus(LinkingProcessState.Completed);
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

            LinkedDevices.addLinkedDevice(
                unlockedVault.LinkedDevices,
                cleanDeviceName,
                syncID,
                remoteKeyBundle.SyncSigningPublicKey,
                remoteKeyBundle.SyncKemPublicKey,
                stunServers.map((server) => server.ID),
                turnServers.map((server) => server.ID),
                signalingServer?.ID,
            );
            setLinkedDevices([...unlockedVault.LinkedDevices.Devices]);
            await vaultMetadata.save(unlockedVault, vaultSecret.value);
            addToProgressLog("Linked device saved.");

            toast.success("Device linked.");
            addToProgressLog("Done. Safe to close this dialog.", "info");
            setIsOperationInProgress(false);
        };

        webRTCDataChannel.onerror = () => {
            if (vaultTransferSentRef.current) {
                return;
            }
            addToProgressLog("Failed to send vault data.", "error");
            setSyncKeyExchangeStatus((current) =>
                current === LinkingProcessState.Completed
                    ? current
                    : LinkingProcessState.Error,
            );
            stopLinking();
        };
        webRTCDataChannel.onclose = () => {
            if (vaultTransferSentRef.current) {
                setIsOperationInProgress(false);
                webRTConnection.close();
                return;
            }
            setSyncKeyExchangeStatus((current) =>
                current === LinkingProcessState.Completed
                    ? current
                    : LinkingProcessState.Error,
            );
            webRTConnection.close();
            setIsOperationInProgress(false);
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
                stopLinking();
            }
        };

        signalingServerConnection.connection.bind(
            "pusher:connection_established",
            () => {
                addToProgressLog("Connected to signaling server.", "info");
            },
        );

        signalingServerConnection.connection.bind("error", (error: unknown) => {
            signalingLog.error("Signaling error during device linking", {
                channelName,
                syncId: syncID,
                error,
            });
            addToProgressLog(
                "Error while setting up private connection.",
                "error",
            );
            setIsOperationInProgress(false);
        });

        wsChannel.bind("pusher:subscription_succeeded", () => {
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
            signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
            stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
            turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID);

        setStage("linking");
        setIsOperationInProgress(true);
        setProgressLog([]);
        progressLogRef.current = [];
        vaultTransferSentRef.current = false;
        setSyncKeyExchangeStatus(LinkingProcessState.Pending);

        try {
            const connectionPackage = await prepareConnectionPackage(
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
            setIsOperationInProgress(false);
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && isOperationInProgress) {
            void cancelFnRef.current();
        }
        onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Link new device</DialogTitle>
                    <DialogDescription>
                        Configure connection first. After confirmation, choose
                        QR or file transfer while linking runs.
                    </DialogDescription>
                </DialogHeader>

                {stage === "configure" ? (
                    <div className="space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="link-device-name">
                                Device name
                            </Label>
                            <Input
                                id="link-device-name"
                                value={deviceName}
                                onChange={(event) =>
                                    setDeviceName(event.target.value)
                                }
                                placeholder="Maya's laptop"
                                autoFocus
                            />
                            <p className="text-xs text-muted-foreground">
                                Name shown in linked devices after pairing.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <ServerSelect
                                label="Signaling"
                                value={signalingServerID}
                                onChange={setSignalingServerID}
                                servers={
                                    unlockedVault.LinkedDevices.SignalingServers
                                }
                            />
                            <ServerMultiSelect
                                label="STUN"
                                value={stunServerIDs}
                                onChange={setSTUNServerIDs}
                                servers={
                                    unlockedVault.LinkedDevices.STUNServers
                                }
                            />
                            <ServerMultiSelect
                                label="TURN"
                                value={turnServerIDs}
                                onChange={setTURNServerIDs}
                                servers={
                                    unlockedVault.LinkedDevices.TURNServers
                                }
                            />
                        </div>

                        {usesOnlineServicesSelection ? (
                            <Alert
                                variant={
                                    onlineServicesIssue
                                        ? "destructive"
                                        : "default"
                                }
                            >
                                <ShieldCheck className="h-4 w-4" />
                                <AlertTitle>Cryptex Online Services</AlertTitle>
                                <AlertDescription className="space-y-3">
                                    <p>
                                        Selected Online Services entry needs
                                        account access and paid-tier linking.
                                    </p>
                                    {onlineServicesIssue === "signin" ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => {
                                                handleOpenChange(false);
                                                onRequireOnlineServicesSignIn?.();
                                            }}
                                        >
                                            Sign in
                                        </Button>
                                    ) : null}
                                    {onlineServicesIssue === "upgrade" ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => {
                                                void navigateToCheckout();
                                            }}
                                        >
                                            Upgrade
                                        </Button>
                                    ) : null}
                                    {!onlineServicesIssue ? (
                                        <Badge variant="secondary">
                                            Online Services available
                                        </Badge>
                                    ) : null}
                                </AlertDescription>
                            </Alert>
                        ) : null}

                        <label className="flex items-start gap-3 rounded-lg border p-3">
                            <Checkbox
                                checked={rootDevice}
                                onCheckedChange={(checked) =>
                                    setRootDevice(checked === true)
                                }
                                disabled={!usesOnlineServicesSelection}
                            />
                            <span className="space-y-1">
                                <span className="block text-sm font-medium">
                                    Make linked device root
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    Available when Online Services handles
                                    device registration.
                                </span>
                            </span>
                        </label>

                        {formError ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {formError}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                        <div className="space-y-4">
                            <div className="rounded-xl border bg-muted/20 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">
                                            {isOperationInProgress
                                                ? "Waiting for other device"
                                                : "Linking finished"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {readyForOtherDevice
                                                ? "Open receive link on other device and use selected method."
                                                : "Preparing private connection..."}
                                        </p>
                                    </div>
                                    {isOperationInProgress ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    ) : (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 rounded-xl border p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">
                                            Transfer method
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Change anytime. Link package stays
                                            same.
                                        </p>
                                    </div>
                                    {selectedLinkMethod === "file" &&
                                    linkingPackageBinary ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                                downloadLinkingPackage(
                                                    linkingPackageBinary,
                                                )
                                            }
                                        >
                                            <Download className="mr-2 h-4 w-4" />
                                            Download again
                                        </Button>
                                    ) : null}
                                </div>

                                <div className="grid gap-2 sm:grid-cols-3">
                                    {(
                                        Object.keys(
                                            linkMethodCopy,
                                        ) as LinkMethod[]
                                    ).map((method) => {
                                        const copy = linkMethodCopy[method];
                                        const Icon = copy.icon;
                                        const disabled = method === "sound";
                                        const active =
                                            selectedLinkMethod === method;

                                        return (
                                            <button
                                                key={method}
                                                type="button"
                                                disabled={disabled}
                                                onClick={() =>
                                                    selectLinkMethod(method)
                                                }
                                                className={cn(
                                                    "rounded-lg border p-3 text-left transition",
                                                    active &&
                                                        "border-primary bg-primary/10",
                                                    disabled &&
                                                        "cursor-not-allowed opacity-50",
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
                                    })}
                                </div>
                            </div>

                            <div className="flex min-h-72 items-center justify-center rounded-xl border bg-muted/10 p-4">
                                {selectedLinkMethod === "qr" ? (
                                    linkingPackageBase64 ? (
                                        <LinkingQRCode
                                            value={linkingPackageBase64}
                                        />
                                    ) : (
                                        <div className="text-sm text-muted-foreground">
                                            QR code preparing...
                                        </div>
                                    )
                                ) : selectedLinkMethod === "file" ? (
                                    <div className="space-y-3 text-center">
                                        <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                                        <p className="text-sm font-medium">
                                            Link file downloaded
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Import it on receiving device, then
                                            enter mnemonic.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">
                                        Sound transfer coming soon.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <PqcKeyExchangeStep
                                status={syncKeyExchangeStatus}
                            />
                            <div className="rounded-xl border p-4">
                                <p className="text-sm font-medium">Mnemonic</p>
                                {mnemonic ? (
                                    <p className="mt-2 select-all rounded-lg bg-muted p-3 text-xs leading-relaxed">
                                        {mnemonic}
                                    </p>
                                ) : (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        Generated after link package is ready.
                                    </p>
                                )}
                            </div>
                            <ProgressLog entries={progressLog} />
                        </div>
                    </div>
                )}

                <DialogFooter>
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
                                Confirm and start linking
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!isOperationInProgress}
                                onClick={() => void cancelFnRef.current()}
                            >
                                Cancel linking
                            </Button>
                            <Button
                                type="button"
                                disabled={isOperationInProgress}
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

function parseReceivedVault(data: Uint8Array) {
    const rawVault = VaultUtilTypes.Vault.decode(data);
    const receivedVault = Object.assign(new Vault(), rawVault);
    receivedVault.LinkedDevices = LinkedDevices.fromGeneric(
        receivedVault.LinkedDevices,
    );
    receivedVault.Credentials = receivedVault.Credentials.map(cloneCredential);
    receivedVault.Groups = receivedVault.Groups.map((group) =>
        Object.assign(new Group(), group),
    );
    receivedVault.upgrade();

    return receivedVault;
}

function ReceiveStepList({ steps }: { steps: ReceiveLinkStep[] }) {
    const iconFor = (status: LinkingProcessState) => {
        if (status === LinkingProcessState.Completed) {
            return (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            );
        }
        if (status === LinkingProcessState.Active) {
            return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
        }
        if (status === LinkingProcessState.Error) {
            return <AlertCircle className="h-4 w-4 text-destructive" />;
        }
        if (status === LinkingProcessState.Warning) {
            return <AlertCircle className="h-4 w-4 text-amber-500" />;
        }
        return <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
    };

    return (
        <div className="space-y-3">
            {steps.map((step) => (
                <div key={step.id} className="flex gap-3 rounded-lg border p-3">
                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                        {iconFor(step.status)}
                    </span>
                    <span className="min-w-0">
                        <span className="block text-sm font-medium">
                            {step.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                            {step.description}
                        </span>
                    </span>
                </div>
            ))}
        </div>
    );
}

export function ReceiveLinkRequestDialog({
    open,
    onOpenChange,
    showWarningDialog,
}: ReceiveLinkRequestDialogProps) {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const [stage, setStage] = useState<ReceiveLinkStage>("input");
    const [method, setMethod] = useState<ReceiveLinkMethod>("qr");
    const [secret, setSecret] = useState("");
    const [showSecret, setShowSecret] = useState(false);
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
        setMethod("qr");
        setSecret("");
        setShowSecret(false);
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

    const getLinkingPackage = async () => {
        if (method === "file") {
            return LinkingPackage.fromBinary(await readLinkFile());
        }

        const parsed = LinkingPackage.fromBase64(qrCodeData.trim());
        if (parsed.isErr()) {
            throw new Error("QR code data is not a valid link package.");
        }
        return parsed.value;
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
        if (!vaultMetadata) {
            throw new Error("Current vault metadata is unavailable.");
        }

        const vaultSecret = getVaultDEKFromSession();
        if (vaultSecret.isErr()) {
            throw new Error(MISSING_VAULT_SECRET_ERROR);
        }

        const receivedVault = parseReceivedVault(receivedVaultData);
        const mergedVault = Object.assign(new Vault(), unlockedVault);
        mergedVault.Credentials =
            unlockedVault.Credentials.map(cloneCredential);
        mergedVault.Groups = unlockedVault.Groups.map((group) =>
            Object.assign(new Group(), group),
        );
        mergedVault.LinkedDevices = LinkedDevices.fromGeneric(
            unlockedVault.LinkedDevices,
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

        const existingGroupIDs = new Set(
            mergedVault.Groups.map((group) => group.ID),
        );
        for (const group of receivedVault.Groups) {
            if (existingGroupIDs.has(group.ID)) continue;
            mergedVault.Groups.push(Object.assign(new Group(), group));
            existingGroupIDs.add(group.ID);
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
            mergedVault.LinkedDevices.Devices.map((device) => device.ID),
        );
        const existingSyncIDs = new Set(
            mergedVault.LinkedDevices.Devices.map((device) => device.SyncID),
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

        await vaultMetadata.save(mergedVault, vaultSecret.value);
        await setUnlockedVault(mergedVault);

        const summary = {
            credentialsAdded,
            credentialsSkipped,
            devicesAdded,
        };
        setMergeSummary(summary);
        addReceiveLog(
            `Merged ${credentialsAdded} credentials and ${devicesAdded} linked devices.`,
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

        setStage("linking");
        setSteps(createReceiveLinkSteps());
        setProgressLog([]);
        progressLogRef.current = [];
        completedRef.current = false;
        failedRef.current = false;
        abortedRef.current = false;
        controllerRef.current = null;

        let receiveUsesOnlineServices = false;
        let receivedOnlineServicesDeviceId: string | null = null;

        try {
            const linkingPackage = await getLinkingPackage();
            const decryptedPackage = await linkingPackage.decryptPackage(
                secret.trim(),
            );

            if (decryptedPackage.isErr()) {
                throw new Error("Mnemonic does not unlock this link package.");
            }

            const linkingBlob = decryptedPackage.value;
            const usesOnlineServices =
                linkingBlob.SignalingServer == null ||
                !linkingBlob.STUNServers.length ||
                !linkingBlob.TURNServers.length;
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
                    setStage("input");
                    addReceiveLog(message, "warn");
                    toast.info(message);
                    return;
                }
            }

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

            const generatedSyncKeys = await ensureSyncSigningKeypair(
                unlockedVault.LinkedDevices,
            );
            const generatedKemKeys = await ensureSyncKemKeypair(
                unlockedVault.LinkedDevices,
            );
            if ((generatedSyncKeys || generatedKemKeys) && vaultMetadata) {
                const vaultSecret = getVaultDEKFromSession();
                if (vaultSecret.isOk()) {
                    await vaultMetadata.save(unlockedVault, vaultSecret.value);
                }
            }

            const controllerResult = await LinkingProcessController.create(
                linkingBlob,
                usesOnlineServices,
                {
                    signingPublicKey:
                        unlockedVault.LinkedDevices.SyncSigningPublicKey,
                    signingPrivateKey:
                        unlockedVault.LinkedDevices.SyncSigningPrivateKey,
                    kemPublicKey: unlockedVault.LinkedDevices.SyncKemPublicKey,
                    kemPrivateKey:
                        unlockedVault.LinkedDevices.SyncKemPrivateKey,
                },
                secret.trim(),
                async (status) => {
                    updateStep(status);

                    if (
                        status.Step === LinkingProcessStep.VaultTransfer &&
                        status.State === LinkingProcessState.Completed &&
                        status.VaultBinaryData
                    ) {
                        await mergeReceivedVault(
                            status.VaultBinaryData,
                            onlineServicesOverwrite,
                            senderKeyBundle,
                        );
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
                    error,
                },
            );
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to receive link request.";
            setFormError(message);
            addReceiveLog(message, "error");
            setStage("input");
            toast.error(message);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Receive vault data</DialogTitle>
                    <DialogDescription>
                        Scan or import the link package, enter the mnemonic,
                        then merge missing credentials and linked devices into
                        this vault.
                    </DialogDescription>
                </DialogHeader>

                {stage === "input" ? (
                    <div className="space-y-5">
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
                                    Fastest when both devices are nearby.
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setMethod("file")}
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
                                    Use a .{LINK_FILE_EXTENSION} file from the
                                    sender.
                                </span>
                            </button>
                        </div>

                        {method === "qr" ? (
                            <div className="space-y-3">
                                <div className="overflow-hidden rounded-xl border bg-muted/20">
                                    {isScanning && !qrCodeData ? (
                                        <BarcodeScanner
                                            onUpdate={(_, result) => {
                                                if (result) {
                                                    setQRCodeData(
                                                        result.getText(),
                                                    );
                                                    setQrChunkProgress(null);
                                                    setIsScanning(false);
                                                }
                                            }}
                                            onChunkProgress={setQrChunkProgress}
                                            onError={(error) => {
                                                uiLog.warn("QR scanner error", {
                                                    error,
                                                });
                                                setQrChunkProgress(null);
                                                setCameraError(
                                                    "Camera unavailable. Paste QR data instead.",
                                                );
                                                setIsScanning(false);
                                            }}
                                        />
                                    ) : (
                                        <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
                                            <QrCode className="h-10 w-10 text-muted-foreground" />
                                            <div>
                                                <p className="text-sm font-medium">
                                                    Scan sender QR code
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    Camera scan fills package
                                                    data automatically.
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setCameraError("");
                                                    setQRCodeData("");
                                                    setQrChunkProgress(null);
                                                    setIsScanning(true);
                                                }}
                                            >
                                                <Camera className="mr-2 h-4 w-4" />
                                                Start camera
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                {qrChunkProgress ? (
                                    <p className="text-sm text-muted-foreground">
                                        Scanned {qrChunkProgress.received} of{" "}
                                        {qrChunkProgress.total} QR parts. Keep
                                        camera pointed at sender.
                                    </p>
                                ) : null}
                                <Textarea
                                    value={qrCodeData}
                                    onChange={(event) =>
                                        setQRCodeData(event.target.value)
                                    }
                                    placeholder="Or paste QR code data here"
                                    rows={4}
                                />
                                {qrCodeData ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setQRCodeData("");
                                            setQrChunkProgress(null);
                                        }}
                                    >
                                        <X className="mr-2 h-4 w-4" />
                                        Clear QR data
                                    </Button>
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
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    const file = Array.from(
                                        event.dataTransfer.files,
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
                                            event.target.files?.[0] ?? null,
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

                        <div className="space-y-2">
                            <Label htmlFor="receive-link-secret">
                                Mnemonic
                            </Label>
                            <div className="relative">
                                <Input
                                    id="receive-link-secret"
                                    type={showSecret ? "text" : "password"}
                                    value={secret}
                                    onChange={(event) =>
                                        setSecret(event.target.value)
                                    }
                                    placeholder="Words shown on sending device"
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            void startReceiving();
                                        }
                                    }}
                                    className="pr-10"
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
                                                {showSecret ? "Hide" : "Show"}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </div>
                        </div>

                        {formError ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {formError}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                        <div className="space-y-4">
                            <div className="rounded-xl border bg-muted/20 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">
                                            {stage === "done"
                                                ? "Vault data merged"
                                                : stage === "aborted"
                                                  ? "Linking aborted"
                                                  : stage === "failed"
                                                    ? "Linking failed"
                                                    : "Receiving vault data"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Current credentials stay untouched.
                                            Missing data is added only.
                                        </p>
                                    </div>
                                    {stage === "done" ? (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    ) : stage === "aborted" ? (
                                        <AlertCircle className="h-5 w-5 text-amber-500" />
                                    ) : stage === "failed" ? (
                                        <AlertCircle className="h-5 w-5 text-destructive" />
                                    ) : (
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                            <ReceiveStepList steps={steps} />
                        </div>
                        <div className="space-y-4">
                            {mergeSummary ? (
                                <div className="rounded-xl border p-4">
                                    <p className="text-sm font-medium">
                                        Merge summary
                                    </p>
                                    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                                        <p>
                                            {mergeSummary.credentialsAdded}{" "}
                                            credentials added
                                        </p>
                                        <p>
                                            {mergeSummary.credentialsSkipped}{" "}
                                            existing credentials skipped
                                        </p>
                                        <p>
                                            {mergeSummary.devicesAdded} linked
                                            devices added
                                        </p>
                                    </div>
                                </div>
                            ) : null}
                            <ProgressLog entries={progressLog} />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    {stage === "input" ? (
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
                                onClick={() => void startReceiving()}
                            >
                                Receive vault data
                            </Button>
                        </>
                    ) : stage === "linking" ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!canAbortWaitingForDevice}
                                onClick={abortWaitingForDevice}
                            >
                                Cancel linking
                            </Button>
                            <Button type="button" disabled>
                                Close
                            </Button>
                        </>
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
