import React, { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    AlertCircle,
    Camera,
    CheckCircle2,
    FileText,
    Loader2,
    Lock,
    QrCode,
    Settings2,
    Upload,
    X,
} from "lucide-react";
import { toast } from "sonner";

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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@/app_lib/proto/vault";
import {
    EncryptDataBlob,
    hashSecret,
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
import { LinkedDevices, OnlineServices, Vault } from "@/app_lib/vault-utils/vault";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import { enumToRecord, LINK_FILE_EXTENSION } from "@/utils/consts";
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
    (Object.entries(stepCopy) as [string, (typeof stepCopy)[LinkingProcessStep]][])
        .map(([id, copy]) => ({
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
                        <span className={cn("mt-0.5", progressColors[entry.type])}>
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
    const [qrCodeData, setQRCodeData] = useState("");
    const [linkFile, setLinkFile] = useState<File | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [cameraError, setCameraError] = useState("");
    const [formError, setFormError] = useState("");
    const [steps, setSteps] = useState<ReceiveLinkStep[]>(createSteps);
    const [progress, setProgress] = useState<ProgressEntry[]>([]);
    const [passphraseConfirm, setPassphraseConfirm] = useState("");
    const [isSavingVault, setIsSavingVault] = useState(false);

    const {
        register,
        handleSubmit,
        control,
        reset: resetEncryptionForm,
        watch,
        formState: { errors: encryptionErrors },
    } = useForm<EncryptionFormGroupSchemaType>({
        resolver: zodResolver(encryptionFormGroupSchema),
        defaultValues: {
            Secret: "",
            Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
            EncryptionKeyDerivationFunction: KeyDerivationFunction.Argon2ID,
            EncryptionConfig: {
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit: KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
        },
    });

    const selectedKdf = watch("EncryptionKeyDerivationFunction");

    const progressRef = useRef<ProgressEntry[]>([]);
    const receivedVaultRef = useRef<Uint8Array | null>(null);
    const controllerRef = useRef<LinkingProcessController | null>(null);
    const completedRef = useRef(false);
    const failedRef = useRef(false);
    const abortedRef = useRef(false);

    const onlineServicesRef = useRef<OnlineServices | null>(null);

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
        setQRCodeData("");
        setLinkFile(null);
        setIsScanning(false);
        setCameraError("");
        setFormError("");
        resetEncryptionForm();
        setPassphraseConfirm("");
        setIsSavingVault(false);
        setSteps(createSteps());
        setProgress([]);
        progressRef.current = [];
        receivedVaultRef.current = null;
        completedRef.current = false;
        failedRef.current = false;
        abortedRef.current = false;
        controllerRef.current = null;
    };

    useEffect(() => () => {
        // Tear down any in-flight controller on unmount.
        controllerRef.current = null;
    }, []);

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
        if (onlineServicesRef.current) {
            vault.OnlineServices = onlineServicesRef.current;
        }
        vault.upgrade();

        const metadata = new VaultMetadata();
        metadata.Name = "Linked vault";
        metadata.CreatedAt = new Date().toISOString();

        const vaultBytes = VaultUtilTypes.Vault.encode(vault).finish();
        metadata.Blob = await EncryptDataBlob(
            vaultBytes,
            await hashSecret(formData.Secret),
            formData.Encryption,
            formData.EncryptionKeyDerivationFunction,
            formData.EncryptionConfig,
            formData.EncryptionConfig,
        );

        await saveVault(
            undefined,
            VaultUtilTypes.VaultMetadata.encode(metadata).finish(),
        );
        vaultLog.info("Linked vault encrypted and persisted", {
            size: rawVaultBinary.byteLength,
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

            receivedDeviceId =
                linkingBlob.OnlineServices?.DeviceId ?? null;

            if (linkingBlob.OnlineServices) {
                onlineServicesRef.current = new OnlineServices(
                    linkingBlob.OnlineServices.DeviceId,
                    linkingBlob.OnlineServices.UserID,
                    linkingBlob.OnlineServices.PublicKeyJWK,
                    linkingBlob.OnlineServices.PrivateKeyJWK,
                );

                // The SW owns the JWT. It alone runs the passkey
                // challenge/verify dance and stores the resulting token
                // so subsequent tRPC requests (which proxy through the
                // SW) can be authenticated without the popup or this
                // link page ever holding the token in memory.
                const establishResult =
                    await establishOnlineServicesSessionViaSW({
                        deviceId: linkingBlob.OnlineServices.DeviceId,
                        privateKeyJWK:
                            linkingBlob.OnlineServices.PrivateKeyJWK,
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

            controllerRef.current = new LinkingProcessController(
                linkingBlob,
                usesOnlineServices,
                async (status) => {
                    updateStep(status);

                    if (
                        status.Step === LinkingProcessStep.VaultTransfer &&
                        status.State === LinkingProcessState.Completed &&
                        status.VaultBinaryData
                    ) {
                        receivedVaultRef.current = status.VaultBinaryData;
                        addProgress("Vault data received.", "done");
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
        <div className="flex h-full flex-col gap-3 p-3">
            <header className="flex items-start gap-2">
                <span className="rounded-md bg-primary/15 p-1.5 text-primary">
                    <Lock className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                    <h1 className="text-sm font-semibold">Link this device</h1>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                        Pair with an existing vault by importing its link
                        package. You will set a passphrase for this device after
                        linking.
                    </p>
                </div>
            </header>

            {stage === "input" ? (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setMethod("qr");
                                uiLog.debug("Selected QR receive method");
                            }}
                            className={cn(
                                "rounded-md border p-2 text-left transition",
                                method === "qr" &&
                                    "border-primary bg-primary/10",
                            )}
                        >
                            <QrCode className="mb-1 h-4 w-4" />
                            <span className="block text-xs font-medium">
                                Scan QR
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                Use your device camera.
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMethod("file");
                                uiLog.debug("Selected file receive method");
                            }}
                            className={cn(
                                "rounded-md border p-2 text-left transition",
                                method === "file" &&
                                    "border-primary bg-primary/10",
                            )}
                        >
                            <FileText className="mb-1 h-4 w-4" />
                            <span className="block text-xs font-medium">
                                Import file
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                .{LINK_FILE_EXTENSION} from the sender.
                            </span>
                        </button>
                    </div>

                    {method === "qr" ? (
                        <div className="space-y-2">
                            <div className="overflow-hidden rounded-md border bg-muted/20">
                                {isScanning && !qrCodeData ? (
                                    <BarcodeScanner
                                        onUpdate={(_, result) => {
                                            if (result) {
                                                setQRCodeData(
                                                    result.getText(),
                                                );
                                                setIsScanning(false);
                                                uiLog.info(
                                                    "QR scan succeeded",
                                                );
                                            }
                                        }}
                                        onError={(error) => {
                                            uiLog.warn("QR scanner error", {
                                                error: String(error),
                                            });
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
                                                setIsScanning(true);
                                            }}
                                        >
                                            <Camera className="mr-1 h-3.5 w-3.5" />
                                            Start camera
                                        </Button>
                                    </div>
                                )}
                            </div>
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
                                    onClick={() => setQRCodeData("")}
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
                                    setLinkFile(
                                        event.target.files?.[0] ?? null,
                                    )
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
                            Mnemonic
                        </Label>
                        <Input
                            id="receive-link-mnemonic"
                            type="password"
                            value={mnemonic}
                            onChange={(
                                event: React.ChangeEvent<HTMLInputElement>,
                            ) => setMnemonic(event.target.value)}
                            placeholder="Words shown on sending device"
                            onKeyDown={(
                                event: React.KeyboardEvent<HTMLInputElement>,
                            ) => {
                                if (event.key === "Enter") {
                                    void startReceiving();
                                }
                            }}
                            className="text-xs"
                        />
                    </div>

                    {formError ? (
                        <p
                            className="text-xs text-destructive"
                            role="alert"
                        >
                            {formError}
                        </p>
                    ) : null}

                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void startReceiving()}
                    >
                        Receive vault data
                    </Button>
                </div>
            ) : stage === "passphrase" ? (
                <form
                    onSubmit={(event) => void savePassphrase(event)}
                    className="flex flex-1 flex-col gap-3 overflow-y-auto"
                >
                    <Alert className="border-emerald-500/60 bg-emerald-500/10">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <AlertTitle className="text-xs">Vault received</AlertTitle>
                        <AlertDescription className="text-[11px] leading-snug">
                            Create a passphrase and choose encryption settings for
                            this device.
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
                        <AccordionItem value="encryption" className="border-b-0">
                            <AccordionTrigger className="rounded-md border px-2 py-1.5 text-[11px] hover:no-underline">
                                <span className="flex items-center gap-1.5">
                                    <Settings2 className="h-3.5 w-3.5" />
                                    Encryption configuration
                                </span>
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="space-y-2 pt-2">
                                    <div className="space-y-1">
                                        <Label
                                            htmlFor="link-encryption-algorithm"
                                            className="text-[11px]"
                                        >
                                            Encryption algorithm
                                        </Label>
                                        <Controller
                                            name="Encryption"
                                            control={control}
                                            render={({ field }) => (
                                                <Select
                                                    value={String(field.value)}
                                                    onValueChange={(value) =>
                                                        field.onChange(
                                                            Number(value),
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger
                                                        id="link-encryption-algorithm"
                                                        className="h-8 text-xs"
                                                    >
                                                        <SelectValue placeholder="Select algorithm" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {Object.entries(
                                                            enumToRecord(
                                                                EncryptionAlgorithm,
                                                            ),
                                                        ).map(
                                                            ([value, label]) => (
                                                                <SelectItem
                                                                    key={label}
                                                                    value={String(
                                                                        value,
                                                                    )}
                                                                >
                                                                    {label}
                                                                </SelectItem>
                                                            ),
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        {encryptionErrors.Encryption ? (
                                            <p className="text-[11px] text-destructive">
                                                {
                                                    encryptionErrors.Encryption
                                                        .message
                                                }
                                            </p>
                                        ) : null}
                                    </div>

                                    <div className="space-y-1">
                                        <Label
                                            htmlFor="link-key-derivation"
                                            className="text-[11px]"
                                        >
                                            Key derivation function
                                        </Label>
                                        <Controller
                                            name="EncryptionKeyDerivationFunction"
                                            control={control}
                                            render={({ field }) => (
                                                <Select
                                                    value={String(field.value)}
                                                    onValueChange={(value) =>
                                                        field.onChange(
                                                            Number(value),
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger
                                                        id="link-key-derivation"
                                                        className="h-8 text-xs"
                                                    >
                                                        <SelectValue placeholder="Select function" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {Object.entries(
                                                            enumToRecord(
                                                                KeyDerivationFunction,
                                                            ),
                                                        ).map(
                                                            ([value, label]) => (
                                                                <SelectItem
                                                                    key={label}
                                                                    value={String(
                                                                        value,
                                                                    )}
                                                                >
                                                                    {label}
                                                                </SelectItem>
                                                            ),
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        {encryptionErrors.EncryptionKeyDerivationFunction ? (
                                            <p className="text-[11px] text-destructive">
                                                {
                                                    encryptionErrors
                                                        .EncryptionKeyDerivationFunction
                                                        .message
                                                }
                                            </p>
                                        ) : null}
                                    </div>

                                    {selectedKdf.toString() ===
                                        KeyDerivationFunction.Argon2ID.toString() && (
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
                                    )}

                                    {selectedKdf.toString() ===
                                        KeyDerivationFunction.PBKDF2.toString() && (
                                        <div className="space-y-1">
                                            <Label
                                                htmlFor="link-pbkdf-iterations"
                                                className="text-[11px]"
                                            >
                                                Iterations
                                            </Label>
                                            <Input
                                                id="link-pbkdf-iterations"
                                                type="number"
                                                min={2}
                                                className="h-8 text-xs"
                                                {...register(
                                                    "EncryptionConfig.iterations",
                                                )}
                                            />
                                        </div>
                                    )}

                                    {encryptionErrors.EncryptionConfig ? (
                                        <p className="text-[11px] text-destructive">
                                            {
                                                encryptionErrors.EncryptionConfig
                                                    .message
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
                        disabled={isSavingVault}
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
