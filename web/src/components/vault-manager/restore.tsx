import {
    ArchiveRestore,
    ArrowRight,
    CheckCircle2,
    Cloud,
    FileKey2,
    FolderOpen,
    LoaderCircle,
    ShieldCheck,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    vaultRestoreFormSchema,
    VaultRestoreFormSchema,
} from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
    createBackupRecoverySessionToken,
    downloadRecoveryBackupBytes,
    listAllRecoverySnapshots,
    recommendNewestSnapshot,
    sortSnapshotsNewestFirst,
    type BackupSnapshot,
} from "@/app_lib/managed-backups";
import { env } from "@/env/public";
import { cn } from "@/lib/utils";
import { BACKUP_FILE_EXTENSION } from "@/utils/consts";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { trpc } from "@/utils/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

type RestoreResult = { dbIndex: number } | false;
type RestoreSource = "local" | "cloud";

function recoveryAuthorizeErrorMessage(error: unknown): string {
    const message =
        error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "";
    if (
        /no (eligible |current.?root |root )?backup/i.test(message) ||
        /account control/i.test(message) ||
        /not available/i.test(message)
    ) {
        return "No backup capable of restoring account control is available. Your Recovery Kit was not consumed.";
    }
    return "Could not authorize backup recovery.";
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function cloudCredentialsKey(userId: string, recoveryPhrase: string): string {
    return `${userId.trim()}\0${recoveryPhrase.trim().replace(/\s+/g, " ")}`;
}

function FileDropzone({
    control,
    file,
    error,
    onFile,
    onRemove,
}: {
    control: ReturnType<typeof useForm<VaultRestoreFormSchema>>["control"];
    file: File | undefined;
    error?: string;
    onFile: (file: File) => void;
    onRemove: () => void;
}) {
    const acceptFiles = (files: Iterable<File>): boolean => {
        const backupFile = Array.from(files).find((candidate) =>
            candidate.name.endsWith(`.${BACKUP_FILE_EXTENSION}`),
        );
        if (backupFile) {
            onFile(backupFile);
            return true;
        }
        toast.error(`Choose a .${BACKUP_FILE_EXTENSION} vault backup file.`);
        return false;
    };

    return (
        <div className="space-y-2">
            <div
                className={cn(
                    "relative rounded-xl border-2 border-dashed transition-all",
                    file
                        ? "border-emerald-500/60 bg-emerald-500/5"
                        : "border-muted-foreground/25 bg-muted/20 hover:border-primary/50 hover:bg-primary/[0.03]",
                    "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
                )}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.preventDefault();
                    acceptFiles(event.dataTransfer.files);
                }}
            >
                <Controller
                    name="BackupFile"
                    control={control}
                    render={({ field }) => (
                        <input
                            id="restore-backup-file"
                            type="file"
                            accept={`.${BACKUP_FILE_EXTENSION}`}
                            className="sr-only"
                            aria-invalid={Boolean(error)}
                            aria-describedby={
                                error ? "restore-backup-file-error" : undefined
                            }
                            onChange={(event) => {
                                const nextFile = event.target.files?.[0];
                                if (!nextFile || !acceptFiles([nextFile])) {
                                    field.onChange(undefined);
                                    event.currentTarget.value = "";
                                }
                            }}
                        />
                    )}
                />
                {file ? (
                    <div className="flex items-center gap-3 p-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <FileKey2 className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                                {file.name || "Unnamed backup"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatBytes(file.size)} - Ready to restore
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onRemove}
                        >
                            Remove
                        </Button>
                    </div>
                ) : (
                    <label
                        htmlFor="restore-backup-file"
                        className="flex cursor-pointer flex-col items-center px-5 py-8 text-center"
                    >
                        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border">
                            <FolderOpen className="h-5 w-5 text-primary" />
                        </span>
                        <span className="text-sm font-medium">
                            Drop your .{BACKUP_FILE_EXTENSION} file here
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                            or click to browse this device
                        </span>
                    </label>
                )}
            </div>
            {error ? (
                <p
                    id="restore-backup-file-error"
                    className="text-xs text-destructive"
                    role="alert"
                >
                    {error}
                </p>
            ) : null}
        </div>
    );
}

function CloudRecoveryPanel({
    userId,
    recoveryPhrase,
    captcha,
    credentialsReady,
    canResumeSession,
    loading,
    snapshots,
    recommendedSnapshotId,
    selectedSnapshotId,
    captchaRef,
    onUserIdChange,
    onRecoveryPhraseChange,
    onCaptchaChange,
    onLoad,
    onSelectSnapshot,
}: {
    userId: string;
    recoveryPhrase: string;
    captcha: string;
    credentialsReady: boolean;
    canResumeSession: boolean;
    loading: boolean;
    snapshots: BackupSnapshot[];
    recommendedSnapshotId: string | null;
    selectedSnapshotId: string | null;
    captchaRef: React.RefObject<TurnstileInstance | null>;
    onUserIdChange: (value: string) => void;
    onRecoveryPhraseChange: (value: string) => void;
    onCaptchaChange: (value: string) => void;
    onLoad: () => void;
    onSelectSnapshot: (id: string) => void;
}) {
    return (
        <div className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex gap-3 rounded-lg bg-muted/50 p-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Your Recovery Kit authorizes access to encrypted root-device
                    restore points. It does not decrypt your vault.
                </p>
            </div>
            <div className="space-y-2">
                <Label htmlFor="restore-cloud-user-id">
                    Online Services User ID
                </Label>
                <Input
                    id="restore-cloud-user-id"
                    value={userId}
                    onChange={(event) => onUserIdChange(event.target.value)}
                    placeholder="Online Services User ID"
                    autoComplete="off"
                    disabled={loading}
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="restore-cloud-recovery-phrase">
                    Recovery Kit phrase
                </Label>
                <Textarea
                    id="restore-cloud-recovery-phrase"
                    value={recoveryPhrase}
                    onChange={(event) =>
                        onRecoveryPhraseChange(event.target.value)
                    }
                    placeholder="Online Services Recovery Kit phrase"
                    className="min-h-20 resize-none"
                    disabled={loading}
                />
            </div>
            {!canResumeSession ? (
                <div className="space-y-2">
                    <Label>Human verification</Label>
                    <div className="overflow-hidden rounded-md">
                        <Turnstile
                            ref={captchaRef}
                            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                            options={{ action: "backup_recovery" }}
                            onSuccess={onCaptchaChange}
                            onExpire={() => onCaptchaChange("")}
                            onError={() => onCaptchaChange("")}
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Verification is used only for cloud recovery.
                    </p>
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Recovery session authorized
                </div>
            )}
            <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={onLoad}
                disabled={
                    loading ||
                    !credentialsReady ||
                    (!canResumeSession && !captcha)
                }
            >
                {loading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                    <Cloud className="h-4 w-4" />
                )}
                Find Root Restore Points
            </Button>
            {snapshots.length ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Root-device restore points</Label>
                        <span className="text-[11px] text-muted-foreground">
                            Newest first
                        </span>
                    </div>
                    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                        {snapshots.map((snapshot) => {
                            const recommended =
                                snapshot.id === recommendedSnapshotId;
                            const selected = snapshot.id === selectedSnapshotId;
                            return (
                                <button
                                    key={snapshot.id}
                                    type="button"
                                    aria-label={`Restore point from ${new Date(snapshot.createdAt).toLocaleString()}${recommended ? ", recommended" : ""}`}
                                    className={cn(
                                        "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted/50",
                                        recommended && "border-primary/40",
                                        selected &&
                                            "border-emerald-500/60 bg-emerald-500/5",
                                    )}
                                    onClick={() =>
                                        onSelectSnapshot(snapshot.id)
                                    }
                                    disabled={loading}
                                >
                                    <span
                                        className={cn(
                                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
                                            selected &&
                                                "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                        )}
                                    >
                                        {selected ? (
                                            <CheckCircle2 className="h-4 w-4" />
                                        ) : (
                                            <ArchiveRestore className="h-4 w-4" />
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-1.5 font-medium">
                                            {new Date(
                                                snapshot.createdAt,
                                            ).toLocaleString()}
                                            {recommended ? (
                                                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                                    Recommended
                                                </span>
                                            ) : null}
                                        </span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        {formatBytes(snapshot.byteLength)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function VaultDetails({
    register,
    nameError,
    descriptionError,
}: {
    register: ReturnType<typeof useForm<VaultRestoreFormSchema>>["register"];
    nameError?: string;
    descriptionError?: string;
}) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="restore-vault-name">Vault name</Label>
                <Input
                    id="restore-vault-name"
                    placeholder="Enter a name for the restored vault"
                    {...register("Name")}
                />
                {nameError ? (
                    <p className="text-xs text-destructive">{nameError}</p>
                ) : null}
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="restore-vault-description">
                        Description
                    </Label>
                    <span className="text-[11px] text-muted-foreground">
                        Optional
                    </span>
                </div>
                <Textarea
                    id="restore-vault-description"
                    placeholder="What is this vault for?"
                    className="min-h-20 resize-none"
                    {...register("Description")}
                />
                {descriptionError ? (
                    <p className="text-xs text-destructive">
                        {descriptionError}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

function RestoreAction({
    source,
    fileReady,
    isSubmitting,
    onSubmit,
}: {
    source: RestoreSource;
    fileReady: boolean;
    isSubmitting: boolean;
    onSubmit: () => void;
}) {
    return (
        <div className="space-y-2">
            <Button
                type="button"
                className="w-full"
                onClick={onSubmit}
                disabled={isSubmitting || !fileReady}
            >
                {isSubmitting ? (
                    <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Restoring encrypted vault…
                    </>
                ) : (
                    <>
                        Restore Vault
                        <ArrowRight className="h-4 w-4" />
                    </>
                )}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                {source === "cloud"
                    ? "The snapshot stays encrypted until you unlock the restored vault."
                    : "A restored copy is created; existing vaults are never overwritten."}
            </p>
        </div>
    );
}

type RestoreLayoutProps = {
    source: RestoreSource;
    cloudEnabled: boolean;
    fileReady: boolean;
    sourceChangeDisabled: boolean;
    onSourceChange: (source: RestoreSource) => void;
    localPanel: ReactNode;
    cloudPanel: ReactNode;
    details: ReactNode;
    action: ReactNode;
};

function RestoreLayout(props: RestoreLayoutProps) {
    return (
        <div className="space-y-5 pt-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">
                        Restore an encrypted vault
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Existing vaults stay untouched.
                    </p>
                </div>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ArchiveRestore className="h-4 w-4" />
                </span>
            </div>
            {props.source === "local" ? props.localPanel : props.cloudPanel}
            {props.cloudEnabled ? (
                <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={props.sourceChangeDisabled}
                        onClick={() =>
                            props.onSourceChange(
                                props.source === "local" ? "cloud" : "local",
                            )
                        }
                    >
                        {props.source === "local"
                            ? "No file? Use Managed Backups (Online Services)"
                            : "Use a backup file instead"}
                    </Button>
                    <div className="h-px flex-1 bg-border" />
                </div>
            ) : null}
            {props.fileReady ? (
                <div className="space-y-4">
                    {props.details}
                    {props.action}
                </div>
            ) : null}
        </div>
    );
}

const RestoreTab: React.FC<{
    executeCallback: (
        formData: VaultRestoreFormSchema,
    ) => Promise<RestoreResult>;
}> = ({ executeCallback }) => {
    const [source, setSource] = useState<RestoreSource>("local");
    const [cloudUserId, setCloudUserId] = useState("");
    const [cloudRecoveryPhrase, setCloudRecoveryPhrase] = useState("");
    const [cloudCaptcha, setCloudCaptcha] = useState("");
    const [sessionToken, setSessionToken] = useState<string | null>(null);
    const [cloudSnapshots, setCloudSnapshots] = useState<BackupSnapshot[]>([]);
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
        null,
    );
    const [cloudLoading, setCloudLoading] = useState(false);
    // Retain the browser-generated token across retries so an interrupted
    // createRecoverySession response can resume with the same session.
    const recoverySessionTokenRef = useRef<string | null>(null);
    const recoveryCredentialsRef = useRef<string>("");
    const cloudCaptchaRef = useRef<TurnstileInstance | null>(null);
    const {
        handleSubmit,
        control,
        register,
        formState: { errors, isSubmitting },
        watch,
        setValue,
        resetField,
    } = useForm<VaultRestoreFormSchema>({
        resolver: zodResolver(vaultRestoreFormSchema),
        defaultValues: {
            Name: `Restored Vault ${new Date().toLocaleString()}`,
            Description: "",
            BackupFile: undefined,
        },
    });

    const selectedFile = watch("BackupFile");
    const fileReady = selectedFile instanceof File;
    const cloudEnabled = isCloudServicesEnabled();
    const orderedSnapshots = useMemo(
        () => sortSnapshotsNewestFirst(cloudSnapshots),
        [cloudSnapshots],
    );
    const recommendedSnapshotId = orderedSnapshots[0]?.id ?? null;
    const normalizedCloudUserId = cloudUserId.trim();
    const normalizedCloudRecoveryPhrase = cloudRecoveryPhrase
        .trim()
        .replace(/\s+/g, " ");
    const currentCloudCredentialsKey = cloudCredentialsKey(
        cloudUserId,
        cloudRecoveryPhrase,
    );
    const canResumeCloudSession = Boolean(
        sessionToken &&
        recoveryCredentialsRef.current === currentCloudCredentialsKey,
    );

    const tryRestore = async (formData: VaultRestoreFormSchema) =>
        (await executeCallback(formData)) !== false;

    const clearSelectedFile = () => {
        resetField("BackupFile");
        setSelectedSnapshotId(null);
        const input = document.getElementById(
            "restore-backup-file",
        ) as HTMLInputElement | null;
        if (input) input.value = "";
    };

    const changeSource = (nextSource: RestoreSource) => {
        if (source !== nextSource && fileReady) {
            clearSelectedFile();
        }
        setSource(nextSource);
    };

    const invalidateCloudRecoveryFor = (nextCredentialsKey: string) => {
        if (
            !recoveryCredentialsRef.current ||
            recoveryCredentialsRef.current === nextCredentialsKey
        ) {
            return;
        }
        if (selectedSnapshotId) clearSelectedFile();
        recoveryCredentialsRef.current = "";
        recoverySessionTokenRef.current = null;
        setSessionToken(null);
        setCloudSnapshots([]);
        setSelectedSnapshotId(null);
    };

    const changeCloudUserId = (value: string) => {
        invalidateCloudRecoveryFor(
            cloudCredentialsKey(value, cloudRecoveryPhrase),
        );
        setCloudUserId(value);
    };

    const changeCloudRecoveryPhrase = (value: string) => {
        invalidateCloudRecoveryFor(cloudCredentialsKey(cloudUserId, value));
        setCloudRecoveryPhrase(value);
    };

    const resetCloudCaptcha = () => {
        setCloudCaptcha("");
        cloudCaptchaRef.current?.reset();
    };

    const loadCloudHistory = async () => {
        if (
            !normalizedCloudUserId ||
            !normalizedCloudRecoveryPhrase ||
            (!canResumeCloudSession && !cloudCaptcha)
        ) {
            toast.error(
                "User ID, Online Services Recovery Kit, and captcha are required.",
            );
            return;
        }
        let activeSessionToken = canResumeCloudSession ? sessionToken : null;
        if (recoveryCredentialsRef.current !== currentCloudCredentialsKey) {
            recoveryCredentialsRef.current = currentCloudCredentialsKey;
            recoverySessionTokenRef.current = null;
            setSessionToken(null);
            setCloudSnapshots([]);
            setSelectedSnapshotId(null);
        }

        setCloudLoading(true);
        try {
            if (!activeSessionToken) {
                activeSessionToken =
                    recoverySessionTokenRef.current ??
                    createBackupRecoverySessionToken();
                recoverySessionTokenRef.current = activeSessionToken;
                try {
                    await trpc.v1.backup.createRecoverySession.mutate({
                        userId: normalizedCloudUserId,
                        recoveryPhrase: normalizedCloudRecoveryPhrase,
                        captchaToken: cloudCaptcha,
                        sessionToken: activeSessionToken,
                    });
                } finally {
                    resetCloudCaptcha();
                }
                // Persist before list/download: Kit may already be consumed even
                // if a later call fails, and retries must reuse this same session.
                setSessionToken(activeSessionToken);
            }
            const items = await listAllRecoverySnapshots(activeSessionToken);
            setCloudSnapshots(items);
            if (!items.length) {
                toast.message(
                    "No root-device restore points were returned for recovery.",
                );
            } else {
                const newest = recommendNewestSnapshot(items);
                if (newest) {
                    toast.message(
                        `Recommended restore point: ${new Date(newest.createdAt).toLocaleString()} (newest root backup).`,
                    );
                }
            }
        } catch (error) {
            setCloudSnapshots([]);
            toast.error(recoveryAuthorizeErrorMessage(error));
        } finally {
            setCloudLoading(false);
        }
    };

    const selectCloudSnapshot = async (snapshotId: string) => {
        if (!sessionToken) return;
        setCloudLoading(true);
        try {
            const result = await downloadRecoveryBackupBytes(
                sessionToken,
                snapshotId,
            );
            const file = new File(
                [new Uint8Array(result.bytes)],
                `cryptexvault-cloud-${result.snapshot.createdAt.getTime()}.${BACKUP_FILE_EXTENSION}`,
                { type: "application/octet-stream" },
            );
            setValue("BackupFile", file, { shouldValidate: true });
            setSelectedSnapshotId(snapshotId);
            toast.success(
                "Encrypted root restore point verified. Name the restored copy to continue.",
            );
        } catch {
            toast.error(
                "The selected backup failed its availability or integrity check.",
            );
        } finally {
            setCloudLoading(false);
        }
    };

    const localPanel = (
        <FileDropzone
            control={control}
            file={fileReady ? selectedFile : undefined}
            error={errors.BackupFile?.message}
            onFile={(file) => {
                setSource("local");
                setValue("BackupFile", file, { shouldValidate: true });
            }}
            onRemove={clearSelectedFile}
        />
    );
    const cloudPanel =
        source === "cloud" ? (
            <CloudRecoveryPanel
                userId={cloudUserId}
                recoveryPhrase={cloudRecoveryPhrase}
                captcha={cloudCaptcha}
                credentialsReady={Boolean(
                    normalizedCloudUserId && normalizedCloudRecoveryPhrase,
                )}
                canResumeSession={canResumeCloudSession}
                loading={cloudLoading}
                snapshots={orderedSnapshots}
                recommendedSnapshotId={recommendedSnapshotId}
                selectedSnapshotId={selectedSnapshotId}
                captchaRef={cloudCaptchaRef}
                onUserIdChange={changeCloudUserId}
                onRecoveryPhraseChange={changeCloudRecoveryPhrase}
                onCaptchaChange={setCloudCaptcha}
                onLoad={loadCloudHistory}
                onSelectSnapshot={selectCloudSnapshot}
            />
        ) : null;
    const details = (
        <VaultDetails
            register={register}
            nameError={errors.Name?.message}
            descriptionError={errors.Description?.message}
        />
    );
    const action = (
        <RestoreAction
            source={source}
            fileReady={fileReady}
            isSubmitting={isSubmitting}
            onSubmit={handleSubmit(tryRestore)}
        />
    );
    return (
        <RestoreLayout
            source={source}
            cloudEnabled={cloudEnabled}
            fileReady={fileReady}
            sourceChangeDisabled={cloudLoading || isSubmitting}
            onSourceChange={changeSource}
            localPanel={localPanel}
            cloudPanel={cloudPanel}
            details={details}
            action={action}
        />
    );
};

export default RestoreTab;
