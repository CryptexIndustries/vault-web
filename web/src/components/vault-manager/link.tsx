import { LinkingPackageBlob } from "@/app_lib/proto/vault";
import {
    LinkingPackage,
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStatus,
    LinkingProcessStep,
} from "@/app_lib/vault-utils/linking";
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { cn } from "@/lib/utils";
import {
    clearOnlineServicesAPIKey,
    setOnlineServicesAPIKey,
} from "@/utils/atoms";
import {
    AlertCircle,
    CheckCircle,
    FileText,
    LoaderCircle,
    QrCode,
    Volume2,
    Wifi,
    X,
} from "lucide-react";
import { Err, err, Ok, ok } from "neverthrow";
import { useRef, useState } from "react";
import { FormInput } from "../general/input-fields";
import BarcodeScanner, { BarcodeFormat } from "../general/qr-scanner";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

type LinkingMethod = "file" | "qr" | "sound";

const RenderLinkingMethodContent: React.FC<{
    linkingMethod: LinkingMethod;
    onReadyToLink: (linkingPackage: LinkingPackageBlob) => void;
}> = ({ linkingMethod, onReadyToLink }) => {
    const [linkFileData, setLinkFileData] = useState<File | null>(null);
    const [qrCodeData, setQrCodeData] = useState("");
    const [inputErrorSecret, setInputErrorSecret] = useState("");
    const [inputFileError, setInputFileError] = useState("");
    const [isValidating, setIsValidating] = useState(false);

    const secretInputRef = useRef<HTMLInputElement>(null);

    const [hasCameraPermission, setHasCameraPermission] = useState(false);
    const [userDeniedCameraPermission, setUserDeniedCameraPermission] =
        useState(false);

    window.addEventListener("camera-permission-granted", () => {
        setHasCameraPermission(true);
        setUserDeniedCameraPermission(false);
    });
    window.addEventListener("camera-permission-denied", () => {
        setHasCameraPermission(false);
        setUserDeniedCameraPermission(true);
    });

    const clearErrorLabels = () => {
        setInputErrorSecret("");
        setInputFileError("");
    };

    const validateSecret = () => {
        // Check if the secret is contains more than one character
        if (
            secretInputRef.current?.value &&
            secretInputRef.current.value.length > 1
        )
            return secretInputRef.current.value;
        return null;
    };

    const validateLinkingData = async () => {
        if (linkingMethod === "file" && linkFileData) {
            // Read the file and return a byte array
            const encryptedData: Err<never, string> | Ok<Uint8Array, never> =
                await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        if (!reader?.result) {
                            resolve(err("Failed to read file."));
                            return;
                        }
                        resolve(
                            ok(new Uint8Array(reader.result as ArrayBuffer)),
                        );
                    };
                    reader.readAsArrayBuffer(linkFileData);
                });

            if (encryptedData.isErr()) return err(encryptedData.error);

            return ok(LinkingPackage.fromBinary(encryptedData.value));
        } else if (linkingMethod === "qr" && qrCodeData?.length) {
            const deserializedDataRes = LinkingPackage.fromBase64(qrCodeData);

            if (deserializedDataRes.isErr())
                return err(deserializedDataRes.error);

            return ok(deserializedDataRes.value);
        }

        return err("Could not determine the data to validate.");
    };

    const tryDecryptLinkingData = async (
        secret: string,
        pkg: LinkingPackage,
    ) => {
        return await pkg.decryptPackage(secret);
    };

    const handleOperation = async () => {
        clearErrorLabels();
        setIsValidating(true);

        await new Promise((resolve) => setTimeout(resolve, 150));

        const secret = validateSecret();
        if (!secret) {
            setInputErrorSecret("This field is required.");
            setIsValidating(false);
            return;
        }
        setInputErrorSecret("");

        const deserializedVaultDataRes = await validateLinkingData();
        if (deserializedVaultDataRes.isErr()) {
            setInputFileError(
                "Failed to validate vault linking data. Details: " +
                    deserializedVaultDataRes.error,
            );
            setIsValidating(false);
            console.error(
                "Failed to validate the linking data.",
                deserializedVaultDataRes.error,
            );
            return;
        }
        setInputFileError("");

        const linkingPackageRes = await tryDecryptLinkingData(
            secret,
            deserializedVaultDataRes.value,
        );

        if (linkingPackageRes.isErr()) {
            console.error(
                "Failed to decrypt the linking package.",
                linkingPackageRes.error,
            );
            setInputFileError("Failed to decrypt the linking package.");
            setIsValidating(false);
            return;
        }

        setIsValidating(false);
        onReadyToLink(linkingPackageRes.value);
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="secret-key">Secret Key *</Label>
                <FormInput
                    ref={secretInputRef}
                    id="secret-key"
                    type="password"
                    className="pr-10"
                    disabled={isValidating}
                    placeholder="Enter your secret key"
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleOperation();
                        }
                    }}
                />
                {inputErrorSecret && (
                    <p className="text-destructive-foreground">
                        {inputErrorSecret}
                    </p>
                )}
            </div>

            {linkingMethod === "file" && (
                <div className="space-y-2">
                    <Label htmlFor="link-file">Link File (.cryxlink)</Label>
                    <div
                        className={cn(
                            "relative rounded-lg border-2 border-dashed p-6 transition-colors",
                            linkFileData
                                ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                                : "border-muted-foreground/25 hover:border-muted-foreground/50",
                            "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
                        )}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add(
                                "border-primary",
                                "bg-primary/5",
                            );
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove(
                                "border-primary",
                                "bg-primary/5",
                            );
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove(
                                "border-primary",
                                "bg-primary/5",
                            );
                            const files = Array.from(e.dataTransfer.files);
                            const linkFile = files.find((file) =>
                                file.name.endsWith(".cryxlink"),
                            );
                            if (linkFile) {
                                setLinkFileData(linkFile);
                            }
                        }}
                    >
                        <input
                            id="link-file"
                            type="file"
                            accept=".cryxlink"
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            disabled={isValidating}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file && file.name.endsWith(".cryxlink")) {
                                    setLinkFileData(file);
                                }
                            }}
                        />
                        <div className="flex flex-col items-center justify-center text-center">
                            {linkFileData ? (
                                <>
                                    <CheckCircle className="mb-2 h-8 w-8 text-green-500" />
                                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                                        Link File Selected
                                    </p>
                                    <p className="mt-1 line-clamp-1 text-ellipsis break-all text-xs text-green-600 dark:text-green-500">
                                        {linkFileData.name}
                                    </p>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="z-10 mt-2 text-xs"
                                        disabled={isValidating}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setLinkFileData(null);
                                            const input =
                                                document.getElementById(
                                                    "link-file",
                                                ) as HTMLInputElement;
                                            if (input) input.value = "";
                                        }}
                                    >
                                        Remove file
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                                        <FileText className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                    <p className="mb-1 text-sm font-medium text-foreground">
                                        Drop your .cryxlink file here, or click
                                        to browse
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Only .cryxlink vault link files are
                                        supported
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                    {inputFileError && (
                        <p className="text-destructive-foreground">
                            {inputFileError}
                        </p>
                    )}
                </div>
            )}

            {linkingMethod === "qr" && (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="qr-data">QR Code Data</Label>
                        <Textarea
                            id="qr-data"
                            value={qrCodeData}
                            onChange={(e) => setQrCodeData(e.target.value)}
                            placeholder="Paste the QR code data or scan using your device camera"
                            rows={4}
                        />
                    </div>
                    <div className="flex items-center justify-center rounded-lg border-2 border-dashed bg-muted/50 p-8">
                        <div className="space-y-2 text-center">
                            {/* While the user hasn't granted permission to use the camera, show a QR code icon */}
                            {!hasCameraPermission &&
                                qrCodeData.length === 0 && (
                                    <div
                                        className="flex cursor-pointer flex-col items-center gap-2"
                                        onClick={() => {
                                            navigator.mediaDevices
                                                .getUserMedia({ video: true })
                                                .then(() => {
                                                    window.dispatchEvent(
                                                        new Event(
                                                            "camera-permission-granted",
                                                        ),
                                                    );
                                                })
                                                .catch((e) => {
                                                    console.warn(
                                                        "QR Code scanner permission denied",
                                                        e,
                                                    );
                                                    window.dispatchEvent(
                                                        new Event(
                                                            "camera-permission-denied",
                                                        ),
                                                    );
                                                });
                                        }}
                                    >
                                        <QrCode className="mx-auto h-12 w-12 text-muted-foreground" />
                                        <div>
                                            <p className="text-sm text-muted-foreground">
                                                QR Code Scanner
                                            </p>

                                            <p className="text-xs text-muted-foreground">
                                                Click to request the camera
                                                permission
                                            </p>

                                            {userDeniedCameraPermission && (
                                                <p className="text-xs text-destructive-foreground">
                                                    Camera permission denied.
                                                    Please allow camera access
                                                    in your browser settings.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            {hasCameraPermission && qrCodeData.length === 0 && (
                                <BarcodeScanner
                                    // width={500}
                                    // height={500}
                                    formats={[BarcodeFormat.QR_CODE]}
                                    onUpdate={(_, result) => {
                                        if (result) {
                                            setQrCodeData(result.getText());
                                        }
                                    }}
                                    onError={(error) => {
                                        if (
                                            error instanceof DOMException &&
                                            error.name === "NotAllowedError"
                                        ) {
                                            // Handle messaging in our app after the user chooses to not allow the camera permissions
                                            console.warn(
                                                "QR Code scanner permission denied",
                                            );
                                            window.dispatchEvent(
                                                new Event(
                                                    "camera-permission-denied",
                                                ),
                                            );
                                        }
                                    }}
                                />
                            )}
                            {qrCodeData.length > 0 && (
                                // Show UI to reset the QR code data
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setQrCodeData("")}
                                >
                                    Reset QR Code data
                                </Button>
                            )}
                        </div>
                    </div>
                    {inputFileError && (
                        <p className="text-destructive-foreground">
                            {inputFileError}
                        </p>
                    )}
                </>
            )}

            {linkingMethod === "sound" && (
                <div className="flex items-center justify-center rounded-lg border-2 border-dashed bg-muted/50 p-8">
                    <div className="space-y-2 text-center">
                        <Volume2 className="mx-auto h-12 w-12 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            Sound Linking
                        </p>
                        <p className="text-xs text-muted-foreground">
                            This feature is currently disabled
                        </p>
                    </div>
                </div>
            )}

            <Button
                variant="outline"
                className="w-full"
                onClick={handleOperation}
                disabled={
                    isValidating ||
                    (linkingMethod === "file" && !linkFileData) ||
                    (linkingMethod === "qr" && !qrCodeData)
                }
            >
                {isValidating && (
                    <span className="flex items-center">
                        <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" />
                        Decrypting the package...
                    </span>
                )}
                {!isValidating && (
                    <span className="flex items-center">
                        <Wifi className="mr-2 h-4 w-4" />
                        Start Linking Process
                    </span>
                )}
            </Button>
        </div>
    );
};

interface LinkingStep {
    id: LinkingProcessStep;
    label: string;
    description: string;
    status: LinkingProcessState;
}

const LinkingInProgress: React.FC<{
    steps: LinkingStep[];
}> = ({ steps }) => {
    return (
        <div className="space-y-4">
            {steps.map((step) => (
                <div key={step.id} className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                        {step.status === LinkingProcessState.Completed && (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500">
                                <CheckCircle className="h-4 w-4 text-white" />
                            </div>
                        )}
                        {step.status === LinkingProcessState.Active && (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary">
                                <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                            </div>
                        )}
                        {step.status === LinkingProcessState.Pending && (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-muted-foreground/30">
                                <div className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground/30"></div>
                            </div>
                        )}
                        {step.status === LinkingProcessState.Error && (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive">
                                <AlertCircle className="h-4 w-4 text-black" />
                            </div>
                        )}
                        {step.status === LinkingProcessState.Warning && (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400">
                                <AlertCircle className="h-4 w-4 text-black" />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                            <p
                                className={cn(
                                    "text-sm font-medium",
                                    step.status ===
                                        LinkingProcessState.Completed &&
                                        "text-green-600",
                                    //step.status === "active" && "text-primary",
                                    step.status ===
                                        LinkingProcessState.Pending &&
                                        "text-muted-foreground",
                                    step.status === LinkingProcessState.Error &&
                                        "text-destructive",
                                    step.status ===
                                        LinkingProcessState.Warning &&
                                        "text-warning",
                                )}
                            >
                                {step.label}
                            </p>
                        </div>
                        {step.description && (
                            <p className="mt-1 text-xs text-muted-foreground">
                                {step.description}
                            </p>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

const LinkTab: React.FC<{
    onLinkingSuccess?: () => void;
}> = ({ onLinkingSuccess }) => {
    const [linkingMethod, setLinkingMethod] = useState<LinkingMethod | null>(
        null,
    );
    const [isLinking, setIsLinking] = useState(false);
    const [linkingSteps, setLinkingSteps] = useState<LinkingStep[]>([
        {
            id: LinkingProcessStep.Signaling,
            label: "Connecting to Signaling Server",
            description: "Establishing connection to coordination server",
            status: LinkingProcessState.Pending,
        },
        {
            id: LinkingProcessStep.SignalingWaitingOtherDevice,
            label: "Waiting for Other Device",
            description: "Waiting for the remote device to respond",
            status: LinkingProcessState.Pending,
        },
        {
            id: LinkingProcessStep.DirectConnection,
            label: "Establishing Direct Private Connection",
            description: "Creating secure peer-to-peer connection",
            status: LinkingProcessState.Pending,
        },
        {
            id: LinkingProcessStep.SignalingCleanup,
            label: "Cleaning up Signaling Server Connection",
            description: "Terminating coordination server connection",
            status: LinkingProcessState.Pending,
        },
        {
            id: LinkingProcessStep.VaultTransfer,
            label: "Transferring Vault Data",
            description: "Securely downloading vault contents",
            status: LinkingProcessState.Pending,
        },
        {
            id: LinkingProcessStep.VaultSave,
            label: "Saving Vault",
            description: "Saving the vault to the local device",
            status: LinkingProcessState.Pending,
        },
        {
            id: LinkingProcessStep.DirectConnectionCleanup,
            label: "Cleaning up Private Connection",
            description: "Closing secure connection and finalizing",
            status: LinkingProcessState.Pending,
        },
    ]);

    // const [logs, setLogs] = useState<LinkingProcessStatus['LogMessage'][]>([]);
    // const [currentStep, setCurrentStep] = useState<LinkingProcessStep>(LinkingProcessStep.Signaling);

    const onStatusChangeVisual = (status: LinkingProcessStatus) => {
        const step = linkingSteps.find((s) => s.id === status.Step);
        if (step) step.status = status.State;
        setLinkingSteps([...linkingSteps]);
        // setCurrentStep(status.Step);

        // Handle logging
        if (status.LogMessage) {
            // Log to console
            const logMethod =
                status.LogMessage.type === "error"
                    ? console.error
                    : status.LogMessage.type === "info"
                      ? console.info
                      : console.debug;

            logMethod(
                `[${status.Step}] ${status.LogMessage.message}`,
                status.LogMessage.details || "",
            );

            // Add to UI logs
            //setLogs(prev => [...prev, status.LogMessage!]);
        }
    };

    const handleReadyToLink = async (linkingPackage: LinkingPackageBlob) => {
        setIsLinking(true);

        const usesOnlineServices =
            linkingPackage.SignalingServer == null ||
            !linkingPackage.STUNServers.length ||
            !linkingPackage.TURNServers.length;

        if (linkingPackage.APIKey) {
            setOnlineServicesAPIKey(linkingPackage.APIKey);
        } else {
            clearOnlineServicesAPIKey();
        }

        new LinkingProcessController(
            linkingPackage,
            usesOnlineServices,
            async (status) => {
                onStatusChangeVisual(status);

                if (
                    status.Step === LinkingProcessStep.VaultTransfer &&
                    status.State === LinkingProcessState.Completed &&
                    status.VaultBinaryData
                ) {
                    const newVaultMetadata =
                        VaultMetadata.deserializeMetadataBinary(
                            status.VaultBinaryData,
                        );
                    await newVaultMetadata.save(null);
                }

                if (
                    status.Step === LinkingProcessStep.DirectConnectionCleanup
                ) {
                    // Wait for 2 seconds to show the success state
                    await new Promise((resolve) => setTimeout(resolve, 1000));

                    // Notify parent of success
                    onLinkingSuccess?.();
                }
            },
        );
    };

    return (
        <div className="space-y-4 pt-4">
            {!linkingMethod ? (
                // Method Selection
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Choose Linking Method</Label>
                        <p className="text-sm text-muted-foreground">
                            Select how you want to link to an existing vault
                            from another device.
                        </p>
                    </div>

                    <div className="grid gap-3">
                        <Button
                            variant="outline"
                            className="h-auto justify-start whitespace-break-spaces p-4"
                            onClick={() => setLinkingMethod("file")}
                        >
                            <div className="flex items-center space-x-3">
                                <FileText className="h-6 w-6 text-primary" />
                                <div className="text-left">
                                    <div className="font-medium">By File</div>
                                    <div className="text-sm text-muted-foreground">
                                        Upload a .cryxlink file from another
                                        device
                                    </div>
                                </div>
                            </div>
                        </Button>

                        <Button
                            variant="outline"
                            className="h-auto justify-start whitespace-break-spaces p-4"
                            onClick={() => setLinkingMethod("qr")}
                        >
                            <div className="flex items-center space-x-3">
                                <QrCode className="h-6 w-6 text-primary" />
                                <div className="text-left">
                                    <div className="font-medium">
                                        By QR Code
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        Scan a QR code displayed on another
                                        device
                                    </div>
                                </div>
                            </div>
                        </Button>

                        <Button
                            variant="outline"
                            className="h-auto cursor-not-allowed justify-start whitespace-break-spaces p-4 opacity-50"
                            disabled
                        >
                            <div className="flex items-center space-x-3">
                                <Volume2 className="h-6 w-6 text-muted-foreground" />
                                <div className="text-left">
                                    <div className="font-medium text-muted-foreground">
                                        By Sound
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        Currently disabled - Audio-based linking
                                    </div>
                                </div>
                            </div>
                        </Button>
                    </div>
                </div>
            ) : (
                // Method-specific content
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-medium">
                                Link{" "}
                                {linkingMethod === "file"
                                    ? "by File"
                                    : linkingMethod === "qr"
                                      ? "by QR Code"
                                      : "by Sound"}
                            </h3>
                            <p className="text-wrap text-sm text-muted-foreground">
                                {linkingMethod === "file" &&
                                    "Use the link file from another device"}
                                {linkingMethod === "qr" &&
                                    "Scan or paste the QR code data"}
                                {linkingMethod === "sound" &&
                                    "Use audio-based linking"}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setLinkingMethod(null);
                                setIsLinking(false);
                            }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    {!isLinking && (
                        <RenderLinkingMethodContent
                            linkingMethod={linkingMethod}
                            onReadyToLink={handleReadyToLink}
                        />
                    )}

                    {isLinking && <LinkingInProgress steps={linkingSteps} />}
                </div>
            )}
        </div>
    );
};

export default LinkTab;
