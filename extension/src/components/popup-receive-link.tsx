import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    AlertCircle,
    Camera,
    CheckCircle2,
    Eye,
    EyeOff,
    FileText,
    Loader2,
    Lock,
    QrCode,
    Settings2,
    Upload,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { ulid } from "ulidx";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@/app_lib/proto/vault";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@/app_lib/vault-utils/encryption";
import {
    LinkingPackage,
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStatus,
    LinkingProcessStep,
} from "@/app_lib/vault-utils/linking";
import {
    EncryptionFormGroupSchemaType,
    encryptionFormGroupSchema,
} from "@/app_lib/vault-utils/form-schemas";
import { saveVault, VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    LinkedDevices,
    OnlineServices,
    Vault,
} from "@/app_lib/vault-utils/vault";
import { ensureSyncSigningKeypair } from "@/app_lib/vault-utils/sync-signing";
import { ensureSyncKemKeypair } from "@/app_lib/vault-utils/post-quantum-kem";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import { LINK_FILE_EXTENSION } from "@/utils/consts";
import {
    clearOnlineServicesSessionViaSW,
    establishOnlineServicesSessionViaSW,
} from "../utils/online-services-session-client";
import { cn } from "@/lib/utils";
import {
    onlineServicesLog,
    signalingLog,
    uiLog,
    vaultLog,
} from "../utils/ext-logging";
import BarcodeScanner from "./qr-scanner";
import type { ChunkedQRCodeProgress } from "@ui/lib/chunked-qr";
import { createLinkedVaultEnvelopeBlob } from "../utils/linked-vault-envelope";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import { KdfBelowRecommendedAck } from "@/components/vault-security/kdf-below-recommended-ack";
import { isBelowOwaspRecommendedArgon2id } from "@/app_lib/vault-utils/password-strength";

type ReceiveLinkMethod = "qr" | "file";
type ReceiveLinkStage =
    | "input"
    | "linking"
    | "passphrase"
    | "done"
    | "failed"
    | "aborted";

type ProgressEntry = {
    message: string;
    type: "info" | "done" | "warn" | "error";
};

type ReceiveLinkStep = {
    id: LinkingProcessStep;
    title: string;
    description: string;
    status: LinkingProcessState;
};

const stepCopy: Record<
    LinkingProcessStep,
    { title: string; description: string }
> = {
    [LinkingProcessStep.Signaling]: {
        title: "Connect",
        description: "Joining the secure linking room.",
    },
    [LinkingProcessStep.SignalingWaitingOtherDevice]: {
        title: "Find sender",
        description: "Waiting for the device sending the vault.",
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
        title: "Save vault",
        description: "Encrypting and storing vault locally.",
    },
    [LinkingProcessStep.DirectConnectionCleanup]: {
        title: "Finish",
        description: "Closing private connection.",
    },
};

const createSteps = (): ReceiveLinkStep[] =>
    (
        Object.entries(stepCopy) as [
            string,
            (typeof stepCopy)[LinkingProcessStep],
        ][]
    ).map(([id, copy]) => ({
        id: Number(id) as LinkingProcessStep,
        title: copy.title,
        description: copy.description,
        status: LinkingProcessState.Pending,
    }));

const progressColors: Record<ProgressEntry["type"], string> = {
    done: "text-emerald-500",
    info: "text-muted-foreground",
    warn: "text-amber-500",
    error: "text-destructive",
};

function ReceiveLinkJourney({ stage }: { stage: ReceiveLinkStage }) {
    const current =
        stage === "input" || stage === "failed" || stage === "aborted"
            ? 0
            : stage === "linking"
              ? 1
              : stage === "passphrase"
                ? 2
                : 3;
    const steps = ["Invitation", "Transfer", "Protect"];

    return (
        <ol className="grid grid-cols-3 gap-1" aria-label="Linking progress">
            {steps.map((label, index) => {
                const complete = current > index;
                const active = current === index;
                return (
                    <li
                        key={label}
                        className={cn(
                            "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px]",
                            complete &&
                                "border-emerald-500/40 bg-emerald-500/10",
                            active && "border-primary bg-primary/10",
                        )}
                    >
                        <span
                            className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px]",
                                complete && "bg-emerald-500 text-white",
                                active && "bg-primary text-primary-foreground",
                            )}
                        >
                            {complete ? "✓" : index + 1}
                        </span>
                        <span className="truncate">{label}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function ReceiveLinkMethodPicker({
    value,
    onChange,
}: {
    value: ReceiveLinkMethod;
    onChange: (method: ReceiveLinkMethod) => void;
}) {
    const methods: {
        id: ReceiveLinkMethod;
        title: string;
        icon: typeof QrCode;
    }[] = [
        {
            id: "qr",
            title: "Scan QR",
            icon: QrCode,
        },
        {
            id: "file",
            title: "Import file",
            icon: FileText,
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {methods.map((item) => {
                const Icon = item.icon;
                const active = value === item.id;
                return (
                    <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(item.id)}
                        className={cn(
                            "flex items-center gap-2 rounded-lg border p-2 text-left transition",
                            active
                                ? "border-primary bg-primary/10 shadow-sm"
                                : "hover:bg-muted/40",
                        )}
                    >
                        <span
                            className={cn(
                                "rounded-md bg-muted p-1.5",
                                active && "bg-primary text-primary-foreground",
                            )}
                        >
                            <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-xs font-medium">
                                {item.title}
                            </span>
                            <span className="block truncate text-[9px] text-muted-foreground">
                                {item.id === "qr"
                                    ? "Recommended"
                                    : "From another device"}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function StepList({ steps }: { steps: ReceiveLinkStep[] }) {
    const iconFor = (state: LinkingProcessState) => {
        if (state === LinkingProcessState.Completed) {
            return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
        }
        if (state === LinkingProcessState.Active) {
            return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
        }
        if (state === LinkingProcessState.Error) {
            return <AlertCircle className="h-4 w-4 text-destructive" />;
        }
        if (state === LinkingProcessState.Warning) {
            return <AlertCircle className="h-4 w-4 text-amber-500" />;
        }
        return <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
    };

    return (
        <div className="space-y-2">
            {steps.map((step) => (
                <div
                    key={step.id}
                    className="flex items-start gap-2 rounded-md border p-2"
                >
                    <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                        {iconFor(step.status)}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">
                            {step.title}
                        </span>
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                            {step.description}
                        </span>
                    </span>
                </div>
            ))}
        </div>
    );
}

function ProgressLog({ entries }: { entries: ProgressEntry[] }) {
    if (!entries.length) {
        return (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Activity appears here once linking starts.
            </div>
        );
    }

    return (
        <ScrollArea className="h-32 rounded-md border bg-muted/20">
            <div className="space-y-1.5 p-2">
                {entries.map((entry, index) => (
                    <div
                        key={`${entry.message}-${index}`}
                        className="flex gap-2 text-[11px] leading-snug"
                    >
                        <span
                            className={cn("mt-0.5", progressColors[entry.type])}
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

export type PopupReceiveLinkProps = {
    onComplete: () => void;
};

const PopupReceiveLink: React.FC<PopupReceiveLinkProps> = ({ onComplete }) => {
    const [stage, setStage] = useState<ReceiveLinkStage>("input");
    const [method, setMethod] = useState<ReceiveLinkMethod>("qr");
    const [mnemonic, setMnemonic] = useState("");
    const [showMnemonic, setShowMnemonic] = useState(false);
    const [qrCodeData, setQRCodeData] = useState("");
    const [linkFile, setLinkFile] = useState<File | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [qrChunkProgress, setQrChunkProgress] =
        useState<ChunkedQRCodeProgress | null>(null);
    const [cameraError, setCameraError] = useState("");
    const [formError, setFormError] = useState("");
    const [steps, setSteps] = useState<ReceiveLinkStep[]>(createSteps);
    const [progress, setProgress] = useState<ProgressEntry[]>([]);
    const [passphraseConfirm, setPassphraseConfirm] = useState("");
    const [isSavingVault, setIsSavingVault] = useState(false);
    const [kdfRiskAcknowledged, setKdfRiskAcknowledged] = useState(false);

    const {
        register,
        handleSubmit,
        watch,
        reset: resetEncryptionForm,
        formState: { errors: encryptionErrors },
    } = useForm<EncryptionFormGroupSchemaType>({
        resolver: zodResolver(encryptionFormGroupSchema),
        defaultValues: {
            Secret: "",
            Encryption: EncryptionAlgorithm.AES256,
            EncryptionKeyDerivationFunction: KeyDerivationFunction.Argon2ID,
            EncryptionConfig: {
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit: KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
        },
    });

    const secret = watch("Secret");
    const memLimit = watch("EncryptionConfig.memLimit");
    const opsLimit = watch("EncryptionConfig.opsLimit");

    useEffect(() => {
        setKdfRiskAcknowledged(false);
    }, [memLimit, opsLimit]);

    const belowRecommendedKdf = isBelowOwaspRecommendedArgon2id(
        Number(memLimit),
        Number(opsLimit),
    );
    const submitBlockedByKdf = belowRecommendedKdf && !kdfRiskAcknowledged;

    const progressRef = useRef<ProgressEntry[]>([]);
    const receivedVaultRef = useRef<Uint8Array | null>(null);
    const controllerRef = useRef<LinkingProcessController | null>(null);
    const completedRef = useRef(false);
    const failedRef = useRef(false);
    const abortedRef = useRef(false);

    const onlineServicesRef = useRef<OnlineServices | null>(null);
    const senderKeyBundleRef = useRef<VaultUtilTypes.SyncKeyBundle | null>(
        null,
    );
    const pendingSyncKeysRef = useRef<{
        signingPublicKey: string;
        signingPrivateKey: string;
        kemPublicKey: string;
        kemPrivateKey: string;
    } | null>(null);

    const addProgress = (
        message: string,
        type: ProgressEntry["type"] = "info",
    ) => {
        const next = [{ message, type }, ...progressRef.current];
        progressRef.current = next;
        setProgress(next);
    };

    const reset = () => {
        setStage("input");
        setMethod("qr");
        setMnemonic("");
        setShowMnemonic(false);
        setQRCodeData("");
        setLinkFile(null);
        setIsScanning(false);
        setQrChunkProgress(null);
        setCameraError("");
        setFormError("");
        resetEncryptionForm();
        setPassphraseConfirm("");
        setKdfRiskAcknowledged(false);
        setIsSavingVault(false);
        setSteps(createSteps());
        setProgress([]);
        progressRef.current = [];
        receivedVaultRef.current = null;
        completedRef.current = false;
        failedRef.current = false;
        abortedRef.current = false;
        controllerRef.current = null;
        onlineServicesRef.current = null;
        senderKeyBundleRef.current = null;
        pendingSyncKeysRef.current = null;
    };

    useEffect(
        () => () => {
            // Tear down any in-flight controller on unmount.
            controllerRef.current = null;
        },
        [],
    );

    const readLinkFile = async (file: File): Promise<Uint8Array> =>
        await new Promise((resolve, reject) => {
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
            reader.readAsArrayBuffer(file);
        });

    const parseLinkingPackage = async (): Promise<LinkingPackage> => {
        if (method === "file") {
            if (!linkFile) throw new Error("Choose a link file first.");
            return LinkingPackage.fromBinary(await readLinkFile(linkFile));
        }

        const parsed = LinkingPackage.fromBase64(qrCodeData.trim());
        if (parsed.isErr()) {
            throw new Error("QR code data is not a valid link package.");
        }
        return parsed.value;
    };

    const updateStep = (status: LinkingProcessStatus) => {
        if (failedRef.current && status.State !== LinkingProcessState.Error) {
            return;
        }

        setSteps((current) =>
            current.map((step) =>
                step.id === status.Step
                    ? { ...step, status: status.State }
                    : step,
            ),
        );

        if (status.LogMessage) {
            const logType =
                status.LogMessage.type === "error" ? "error" : "info";
            addProgress(status.LogMessage.message, logType);

            if (status.LogMessage.type === "error") {
                signalingLog.error(status.LogMessage.message, {
                    step: LinkingProcessStep[status.Step],
                    details: status.LogMessage.details,
                });
            } else if (status.LogMessage.type === "debug") {
                signalingLog.debug(status.LogMessage.message, {
                    step: LinkingProcessStep[status.Step],
                });
            } else {
                signalingLog.info(status.LogMessage.message, {
                    step: LinkingProcessStep[status.Step],
                });
            }
        }

        if (status.State === LinkingProcessState.Error && !failedRef.current) {
            failedRef.current = true;
            setStage("failed");
            toast.error(status.LogMessage?.message ?? "Linking failed.");
        }
    };

    const sealLinkedVault = async (
        rawVaultBinary: Uint8Array,
        formData: EncryptionFormGroupSchemaType,
    ) => {
        const raw = VaultUtilTypes.Vault.decode(rawVaultBinary);
        const vault = Object.assign(new Vault(), raw);
        vault.LinkedDevices = LinkedDevices.fromGeneric(vault.LinkedDevices);
        if (pendingSyncKeysRef.current) {
            vault.LinkedDevices.SyncSigningPublicKey =
                pendingSyncKeysRef.current.signingPublicKey;
            vault.LinkedDevices.SyncSigningPrivateKey =
                pendingSyncKeysRef.current.signingPrivateKey;
            vault.LinkedDevices.SyncKemPublicKey =
                pendingSyncKeysRef.current.kemPublicKey;
            vault.LinkedDevices.SyncKemPrivateKey =
                pendingSyncKeysRef.current.kemPrivateKey;
        } else {
            await ensureSyncSigningKeypair(vault.LinkedDevices);
            await ensureSyncKemKeypair(vault.LinkedDevices);
        }

        if (senderKeyBundleRef.current) {
            // Realistically, there will be only one device in the Devices list.
            for (const device of vault.LinkedDevices.Devices) {
                device.RemoteSyncPublicKey =
                    senderKeyBundleRef.current.SyncSigningPublicKey;
                device.RemoteSyncKemPublicKey =
                    senderKeyBundleRef.current.SyncKemPublicKey;
            }
        }
        if (onlineServicesRef.current) {
            vault.OnlineServices = onlineServicesRef.current;
        }
        await vault.upgrade();

        const metadata = new VaultMetadata();
        metadata.Name = "Linked vault";
        metadata.CreatedAt = new Date().toISOString();

        const vaultBytes = VaultUtilTypes.Vault.encode(vault).finish();
        const vaultId = ulid();
        metadata.Blob = await createLinkedVaultEnvelopeBlob(vaultBytes, {
            vaultId,
            masterPassword: formData.Secret,
            kdfConfig: new KeyDerivationConfig_Argon2ID(
                formData.EncryptionConfig.memLimit,
                formData.EncryptionConfig.opsLimit,
            ),
        });

        await saveVault(
            undefined,
            VaultUtilTypes.VaultMetadata.encode(metadata).finish(),
        );
        vaultLog.info("Linked vault encrypted and persisted", {
            size: rawVaultBinary.byteLength,
            vaultId,
        });
    };

    const savePassphrase = handleSubmit(async (formData) => {
        if (!receivedVaultRef.current) {
            setFormError("No vault data to save.");
            return;
        }

        if (formData.Secret !== passphraseConfirm) {
            setFormError("Passphrases do not match.");
            return;
        }

        setFormError("");
        setIsSavingVault(true);
        try {
            await sealLinkedVault(receivedVaultRef.current, formData);
            receivedVaultRef.current = null;
            resetEncryptionForm();
            setPassphraseConfirm("");
            setStage("done");
            toast.success("Vault saved.");
        } catch (error) {
            vaultLog.error("Failed to seal linked vault", { error });
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Failed to save vault.",
            );
        } finally {
            setIsSavingVault(false);
        }
    });

    const startReceiving = async () => {
        if (stage !== "input") return;

        if (!mnemonic.trim()) {
            setFormError("Enter the mnemonic shown on the sending device.");
            return;
        }
        if (method === "file" && !linkFile) {
            setFormError("Choose the link file to import.");
            return;
        }
        if (method === "qr" && !qrCodeData.trim()) {
            setFormError("Scan or paste the QR payload from the sender.");
            return;
        }

        setFormError("");
        setStage("linking");
        setSteps(createSteps());
        setProgress([]);
        progressRef.current = [];
        completedRef.current = false;
        failedRef.current = false;
        abortedRef.current = false;
        controllerRef.current = null;

        let receivedDeviceId: string | null = null;

        try {
            const linkingPackage = await parseLinkingPackage();
            const decryptedPackage = await linkingPackage.decryptPackage(
                mnemonic.trim(),
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

            receivedDeviceId = linkingBlob.OnlineServices?.DeviceId ?? null;

            if (linkingBlob.OnlineServices) {
                onlineServicesRef.current = new OnlineServices(
                    linkingBlob.OnlineServices.DeviceId,
                    linkingBlob.OnlineServices.UserID,
                    linkingBlob.OnlineServices.PublicKeyJWK,
                    linkingBlob.OnlineServices.PrivateKeyJWK,
                );

                // The SW owns the JWT. It alone runs the device signing key
                // challenge/verify dance and stores the resulting token
                // so subsequent tRPC requests (which proxy through the
                // SW) can be authenticated without the popup or this
                // link page ever holding the token in memory.
                const establishResult =
                    await establishOnlineServicesSessionViaSW({
                        deviceId: linkingBlob.OnlineServices.DeviceId,
                        privateKeyJWK: linkingBlob.OnlineServices.PrivateKeyJWK,
                    });
                if (establishResult.ok) {
                    onlineServicesLog.info(
                        "Online Services session established from link package",
                        { deviceId: receivedDeviceId },
                    );
                    addProgress(
                        "Online Services authentication applied.",
                        "done",
                    );
                } else {
                    onlineServicesLog.error(
                        "Failed to establish Online Services session",
                        {
                            error: establishResult.error,
                            deviceId: receivedDeviceId,
                        },
                    );
                    addProgress(
                        "Online Services authentication failed; continuing without it.",
                        "warn",
                    );
                }
            } else {
                await clearOnlineServicesSessionViaSW();
            }

            addProgress("Link package unlocked.", "done");
            vaultLog.info("Link package decrypted", {
                usesOnlineServices,
                hasSignaling: !!linkingBlob.SignalingServer,
            });

            senderKeyBundleRef.current = linkingBlob.SenderKeyBundle;

            const pendingLinkedDevices = new LinkedDevices();
            await ensureSyncSigningKeypair(pendingLinkedDevices);
            await ensureSyncKemKeypair(pendingLinkedDevices);
            pendingSyncKeysRef.current = {
                signingPublicKey: pendingLinkedDevices.SyncSigningPublicKey,
                signingPrivateKey: pendingLinkedDevices.SyncSigningPrivateKey,
                kemPublicKey: pendingLinkedDevices.SyncKemPublicKey,
                kemPrivateKey: pendingLinkedDevices.SyncKemPrivateKey,
            };

            const controllerResult = await LinkingProcessController.create(
                linkingBlob,
                usesOnlineServices,
                {
                    signingPublicKey: pendingLinkedDevices.SyncSigningPublicKey,
                    signingPrivateKey:
                        pendingLinkedDevices.SyncSigningPrivateKey,
                    kemPublicKey: pendingLinkedDevices.SyncKemPublicKey,
                    kemPrivateKey: pendingLinkedDevices.SyncKemPrivateKey,
                },
                mnemonic.trim(),
                async (status) => {
                    updateStep(status);

                    if (
                        status.Step === LinkingProcessStep.VaultTransfer &&
                        status.State === LinkingProcessState.Completed &&
                        status.VaultBinaryData
                    ) {
                        receivedVaultRef.current = status.VaultBinaryData;
                        addProgress(
                            "Vault authenticity confirmed. Ready to choose a passphrase.",
                            "done",
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
                        if (!receivedVaultRef.current) {
                            failedRef.current = true;
                            setStage("failed");
                            toast.error("No vault data received.");
                            return;
                        }
                        setStage("passphrase");
                        toast.success("Vault received. Choose a passphrase.");
                    }
                },
            );
            if (controllerResult.isErr()) {
                throw controllerResult.error;
            }
            controllerRef.current = controllerResult.value;
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to receive link request.";
            vaultLog.error("Failed to receive link request", {
                method,
                hasLinkFile: !!linkFile,
                hasQRCodeData: !!qrCodeData.trim(),
                error,
            });
            setFormError(message);
            addProgress(message, "error");
            setStage("input");
            toast.error(message);
        }
    };

    const abortWaiting = () => {
        if (!controllerRef.current) return;
        controllerRef.current.abortWaitingForDevice();
        controllerRef.current = null;
        abortedRef.current = true;
        setStage("aborted");
        addProgress("Linking aborted.", "warn");
        toast.info("Linking aborted.");
    };

    const canAbortWaiting =
        stage === "linking" &&
        steps.some(
            (step) =>
                step.id === LinkingProcessStep.SignalingWaitingOtherDevice &&
                step.status === LinkingProcessState.Active,
        );
    return (
        <div className="flex h-full flex-col gap-3 p-3 sm:p-4">
            <header className="flex items-start gap-2">
                <span className="rounded-lg bg-primary/15 p-2 text-primary">
                    <Lock className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">
                        Guided setup
                    </p>
                    <h1 className="text-sm font-semibold">
                        Connect this browser
                    </h1>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                        Open &quot;Link new device&quot; in your other vault,
                        then bring its secure invitation here.
                    </p>
                </div>
            </header>

            <ReceiveLinkJourney stage={stage} />

            {stage === "input" ? (
                <div className="flex flex-col gap-3">
                    <ReceiveLinkMethodPicker
                        value={method}
                        onChange={(nextMethod) => {
                            setMethod(nextMethod);
                            uiLog.debug("Selected receive method", {
                                method: nextMethod,
                            });
                        }}
                    />

                    {method === "qr" ? (
                        <div className="space-y-2">
                            <div className="overflow-hidden rounded-md border bg-muted/20">
                                {isScanning && !qrCodeData ? (
                                    <BarcodeScanner
                                        onUpdate={(_, result) => {
                                            if (result) {
                                                setQRCodeData(result.getText());
                                                setQrChunkProgress(null);
                                                setIsScanning(false);
                                                uiLog.info("QR scan succeeded");
                                            }
                                        }}
                                        onChunkProgress={setQrChunkProgress}
                                        onError={(error) => {
                                            uiLog.warn("QR scanner error", {
                                                error: String(error),
                                            });
                                            setQrChunkProgress(null);
                                            setCameraError(
                                                "Camera unavailable. Paste QR data instead.",
                                            );
                                            setIsScanning(false);
                                        }}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
                                        <QrCode className="h-6 w-6 text-muted-foreground" />
                                        <p className="text-xs text-muted-foreground">
                                            Scan the QR or paste its payload
                                            below.
                                        </p>
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
                                            <Camera className="mr-1 h-3.5 w-3.5" />
                                            Start camera
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {qrChunkProgress ? (
                                <div className="space-y-1.5">
                                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20">
                                        <div
                                            className="h-full rounded-full bg-primary transition-all"
                                            style={{
                                                width: `${(qrChunkProgress.received / qrChunkProgress.total) * 100}%`,
                                            }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Scanned {qrChunkProgress.received} of{" "}
                                        {qrChunkProgress.total} QR parts. Keep
                                        camera pointed at sender.
                                    </p>
                                </div>
                            ) : null}
                            <Textarea
                                value={qrCodeData}
                                onChange={(
                                    event: React.ChangeEvent<HTMLTextAreaElement>,
                                ) => setQRCodeData(event.target.value)}
                                placeholder="Paste QR payload"
                                rows={2}
                                className="text-xs"
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
                                    <X className="mr-1 h-3.5 w-3.5" />
                                    Clear QR data
                                </Button>
                            ) : null}
                            {cameraError ? (
                                <p className="text-xs text-destructive">
                                    {cameraError}
                                </p>
                            ) : null}
                        </div>
                    ) : (
                        <div
                            className={cn(
                                "relative rounded-md border border-dashed p-4 text-center transition",
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
                                    setLinkFile(event.target.files?.[0] ?? null)
                                }
                            />
                            <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                            <p className="text-xs font-medium">
                                {linkFile
                                    ? linkFile.name
                                    : `Drop .${LINK_FILE_EXTENSION} file here`}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                                {linkFile
                                    ? "Click or drop another file to replace."
                                    : "Click to browse if drag and drop is not available."}
                            </p>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label
                            htmlFor="receive-link-mnemonic"
                            className="text-xs"
                        >
                            Verification words
                        </Label>
                        <p className="text-[10px] leading-snug text-muted-foreground">
                            Enter the words shown below the invitation in your
                            other vault. They prevent anyone else from using it.
                        </p>
                        <div className="relative">
                            <Input
                                id="receive-link-mnemonic"
                                type={showMnemonic ? "text" : "password"}
                                value={mnemonic}
                                onChange={(
                                    event: React.ChangeEvent<HTMLInputElement>,
                                ) => setMnemonic(event.target.value)}
                                placeholder="Words shown in the other vault"
                                onKeyDown={(
                                    event: React.KeyboardEvent<HTMLInputElement>,
                                ) => {
                                    if (event.key === "Enter") {
                                        void startReceiving();
                                    }
                                }}
                                className="pr-9 text-xs"
                            />
                            <button
                                type="button"
                                onClick={() =>
                                    setShowMnemonic((value) => !value)
                                }
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                                aria-label={
                                    showMnemonic
                                        ? "Hide verification words"
                                        : "Show verification words"
                                }
                            >
                                {showMnemonic ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                )}
                            </button>
                        </div>
                    </div>

                    {formError ? (
                        <p className="text-xs text-destructive" role="alert">
                            {formError}
                        </p>
                    ) : null}

                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void startReceiving()}
                    >
                        Connect with this vault
                    </Button>
                </div>
            ) : stage === "passphrase" ? (
                <form
                    onSubmit={(event) => void savePassphrase(event)}
                    className="flex flex-1 flex-col gap-3 overflow-y-auto"
                >
                    <Alert className="border-emerald-500/60 bg-emerald-500/10">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <AlertTitle className="text-xs">
                            Vault received
                        </AlertTitle>
                        <AlertDescription className="text-[11px] leading-snug">
                            Create a passphrase for this device. Linked
                            extension vaults use AES-GCM with Argon2ID.
                        </AlertDescription>
                    </Alert>
                    <div className="space-y-1.5">
                        <Label htmlFor="link-passphrase" className="text-xs">
                            Passphrase
                        </Label>
                        <Input
                            id="link-passphrase"
                            type="password"
                            className="text-xs"
                            autoComplete="new-password"
                            {...register("Secret")}
                        />
                        {encryptionErrors.Secret ? (
                            <p className="text-[11px] text-destructive">
                                {encryptionErrors.Secret.message}
                            </p>
                        ) : null}
                        <PasswordStrengthMeter password={secret} compact />
                    </div>
                    <div className="space-y-1.5">
                        <Label
                            htmlFor="link-passphrase-confirm"
                            className="text-xs"
                        >
                            Confirm passphrase
                        </Label>
                        <Input
                            id="link-passphrase-confirm"
                            type="password"
                            value={passphraseConfirm}
                            onChange={(event) =>
                                setPassphraseConfirm(event.target.value)
                            }
                            className="text-xs"
                            autoComplete="new-password"
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    void savePassphrase();
                                }
                            }}
                        />
                    </div>

                    <Accordion type="single" collapsible>
                        <AccordionItem
                            value="encryption"
                            className="border-b-0"
                        >
                            <AccordionTrigger className="rounded-md border px-2 py-1.5 text-[11px] hover:no-underline">
                                <span className="flex items-center gap-1.5">
                                    <Settings2 className="h-3.5 w-3.5" />
                                    Encryption configuration
                                </span>
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="space-y-2 pt-2">
                                    <p className="text-[11px] text-muted-foreground">
                                        Algorithm is fixed to AES-GCM. KEK is
                                        derived from this passphrase with
                                        Argon2ID.
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label
                                                htmlFor="link-mem-limit"
                                                className="text-[11px]"
                                            >
                                                Memory limit (MiB)
                                            </Label>
                                            <Input
                                                id="link-mem-limit"
                                                type="number"
                                                min={
                                                    KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT
                                                }
                                                className="h-8 text-xs"
                                                {...register(
                                                    "EncryptionConfig.memLimit",
                                                )}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label
                                                htmlFor="link-ops-limit"
                                                className="text-[11px]"
                                            >
                                                Operations limit
                                            </Label>
                                            <Input
                                                id="link-ops-limit"
                                                type="number"
                                                min={
                                                    KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT
                                                }
                                                max={
                                                    KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                                                }
                                                className="h-8 text-xs"
                                                {...register(
                                                    "EncryptionConfig.opsLimit",
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <KdfBelowRecommendedAck
                                        memLimit={Number(memLimit)}
                                        opsLimit={Number(opsLimit)}
                                        acknowledged={kdfRiskAcknowledged}
                                        onAcknowledgedChange={
                                            setKdfRiskAcknowledged
                                        }
                                        compact
                                    />

                                    {encryptionErrors.EncryptionConfig ? (
                                        <p className="text-[11px] text-destructive">
                                            {
                                                encryptionErrors
                                                    .EncryptionConfig.message
                                            }
                                        </p>
                                    ) : null}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    {formError ? (
                        <p className="text-xs text-destructive" role="alert">
                            {formError}
                        </p>
                    ) : null}
                    <Button
                        type="submit"
                        size="sm"
                        disabled={isSavingVault || submitBlockedByKdf}
                    >
                        {isSavingVault ? (
                            <>
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                Saving…
                            </>
                        ) : (
                            "Save vault"
                        )}
                    </Button>
                </form>
            ) : (
                <div className="flex flex-1 flex-col gap-3 overflow-hidden">
                    <Alert
                        className={cn(
                            stage === "failed" &&
                                "border-destructive/60 bg-destructive/10",
                            stage === "aborted" &&
                                "border-amber-500/60 bg-amber-500/10",
                            stage === "done" &&
                                "border-emerald-500/60 bg-emerald-500/10",
                        )}
                    >
                        {stage === "done" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : stage === "failed" ? (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : stage === "aborted" ? (
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                        ) : (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        <AlertTitle className="text-xs">
                            {stage === "done"
                                ? "Vault saved"
                                : stage === "aborted"
                                  ? "Linking aborted"
                                  : stage === "failed"
                                    ? "Linking failed"
                                    : "Receiving vault data"}
                        </AlertTitle>
                        <AlertDescription className="text-[11px] leading-snug">
                            {stage === "done"
                                ? "Unlock the vault with the passphrase you just created."
                                : "Keep this page open until linking completes."}
                        </AlertDescription>
                    </Alert>
                    <StepList steps={steps} />
                    <ProgressLog entries={progress} />
                    <div className="mt-auto flex gap-2">
                        {stage === "linking" ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                disabled={!canAbortWaiting}
                                onClick={abortWaiting}
                            >
                                Cancel linking
                            </Button>
                        ) : stage === "done" ? (
                            <Button
                                type="button"
                                size="sm"
                                className="w-full"
                                onClick={onComplete}
                            >
                                Continue to unlock
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={reset}
                            >
                                Try again
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PopupReceiveLink;
