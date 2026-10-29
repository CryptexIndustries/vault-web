import {
    ArchiveRestore,
    CheckCircle2,
    Database,
    LoaderCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
    validateBackupDestinationInput,
    type BackupDestinationInput,
    type BackupObject,
} from "@cryptex-industries/vault-core/vault-utils/backup-destinations";

import { describeBackupDestinationError } from "@/app_lib/backup-destination-errors";
import { cn } from "@/lib/utils";
import { BACKUP_FILE_EXTENSION } from "@/utils/consts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { PasswordInput } from "../ui/password-input";
import { Switch } from "../ui/switch";

const PLATFORM_LABELS: Record<BackupObject["platform"], string> = {
    web: "Web app",
    extension: "Browser extension",
    android: "Android",
};

type Fields = Omit<BackupDestinationInput, "Name" | "KeepAll">;

/** Lists the backups in a bucket and hands the chosen one over as a file. */
export function RestoreBucketPanel({
    disabled,
    onFile,
    onClear,
}: {
    disabled: boolean;
    onFile: (file: File) => void;
    /** The selected backup no longer matches the bucket details. */
    onClear: () => void;
}) {
    const [fields, setFields] = useState<Fields>({
        Endpoint: "",
        Region: "",
        Bucket: "",
        Prefix: "",
        PathStyle: false,
        AccessKeyID: "",
        SecretAccessKey: "",
    });
    const [backups, setBackups] = useState<BackupObject[] | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Only the latest request may update the restore screen, and none after
    // the panel closes: a slow download must not replace a newer selection.
    const request = useRef(0);
    useEffect(
        () => () => {
            request.current += 1;
        },
        [],
    );

    const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
        setFields((current) => ({ ...current, [key]: value }));
        request.current += 1;
        if (selectedKey) onClear();
        setLoading(false);
        setBackups(null);
        setSelectedKey(null);
        setError("");
    };

    const location = () => {
        const validation = validateBackupDestinationInput({
            ...fields,
            Name: "Restore",
            KeepAll: true,
        });
        if (!validation.ok) {
            setError(validation.message);
            return null;
        }
        return validation.value;
    };

    const findBackups = async () => {
        const destination = location();
        if (!destination) return;
        const id = ++request.current;
        setLoading(true);
        try {
            const { listBackupsInDestination } =
                await import("@cryptex-industries/vault-core/vault-utils/backup-destination-transfers");
            const found = await listBackupsInDestination(destination);
            if (id !== request.current) return;
            setBackups(found);
            if (!found.length) {
                setError("No Cryptex Vault backups under this folder.");
            }
        } catch (cause) {
            if (id !== request.current) return;
            setError(
                describeBackupDestinationError(cause) ??
                    "Couldn't list the bucket.",
            );
        } finally {
            if (id === request.current) setLoading(false);
        }
    };

    const select = async (backup: BackupObject) => {
        const destination = location();
        if (!destination) return;
        const id = ++request.current;
        setLoading(true);
        try {
            const { getS3Object } =
                await import("@cryptex-industries/vault-core/vault-utils/s3-client");
            const bytes = await getS3Object(
                destination,
                backup.key,
                undefined,
                backup.size,
            );
            if (id !== request.current) return;
            onFile(
                new File(
                    [new Uint8Array(bytes)],
                    `cryptexvault-bucket-${backup.createdAt}.${BACKUP_FILE_EXTENSION}`,
                    { type: "application/octet-stream" },
                ),
            );
            setSelectedKey(backup.key);
            toast.success(
                "Backup downloaded. Name the restored copy to continue.",
            );
        } catch (cause) {
            if (id !== request.current) return;
            setError(
                describeBackupDestinationError(cause) ??
                    "Couldn't download the backup.",
            );
        } finally {
            if (id === request.current) setLoading(false);
        }
    };

    const input = (
        key: "Endpoint" | "Region" | "Bucket" | "Prefix" | "AccessKeyID",
        label: string,
        placeholder?: string,
    ) => (
        <div className="space-y-2">
            <Label htmlFor={`restore-bucket-${key}`}>{label}</Label>
            <Input
                id={`restore-bucket-${key}`}
                value={fields[key]}
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
                disabled={loading || disabled}
                onChange={(event) => set(key, event.target.value)}
            />
        </div>
    );

    return (
        <div className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex gap-3 rounded-lg bg-muted/50 p-3">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Enter the bucket your devices back up to. Backups stay
                    encrypted until you unlock the restored vault.
                </p>
            </div>
            {input(
                "Endpoint",
                "Endpoint",
                "https://s3.eu-central-1.amazonaws.com",
            )}
            <div className="grid gap-4 sm:grid-cols-2">
                {input("Bucket", "Bucket")}
                {input("Region", "Region", "us-east-1")}
            </div>
            {input("Prefix", "Folder (optional)")}
            <div className="flex items-center justify-between gap-4">
                <Label htmlFor="restore-bucket-PathStyle">
                    Path-style addresses
                </Label>
                <Switch
                    id="restore-bucket-PathStyle"
                    checked={fields.PathStyle}
                    disabled={loading || disabled}
                    onCheckedChange={(checked) => set("PathStyle", checked)}
                />
            </div>
            {input("AccessKeyID", "Access key ID")}
            <div className="space-y-2">
                <Label htmlFor="restore-bucket-SecretAccessKey">
                    Secret access key
                </Label>
                <PasswordInput
                    id="restore-bucket-SecretAccessKey"
                    value={fields.SecretAccessKey}
                    secretLabel="secret access key"
                    autoComplete="off"
                    disabled={loading || disabled}
                    onChange={(event) =>
                        set("SecretAccessKey", event.target.value)
                    }
                />
            </div>
            {error ? (
                <p className="text-sm text-destructive" role="alert">
                    {error}
                </p>
            ) : null}
            <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => void findBackups()}
                disabled={loading || disabled}
            >
                {loading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                    <Database className="h-4 w-4" />
                )}
                Find backups
            </Button>
            {backups?.length ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Backups</Label>
                        <span className="text-[11px] text-muted-foreground">
                            Newest first
                        </span>
                    </div>
                    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                        {backups.map((backup) => {
                            const selected = backup.key === selectedKey;
                            const date = new Date(
                                backup.createdAt,
                            ).toLocaleString();
                            const device = `${PLATFORM_LABELS[backup.platform]} ${backup.deviceID.slice(-6)}`;
                            return (
                                <button
                                    key={backup.key}
                                    type="button"
                                    aria-label={`Backup from ${date}, ${device}`}
                                    className={cn(
                                        "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted/50",
                                        selected &&
                                            "border-emerald-500/60 bg-emerald-500/5",
                                    )}
                                    onClick={() => void select(backup)}
                                    disabled={loading || disabled}
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
                                        <span className="block font-medium">
                                            {date}
                                        </span>
                                        <span className="block text-muted-foreground">
                                            {device}
                                        </span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        {Math.max(
                                            1,
                                            Math.round(backup.size / 1024),
                                        )}{" "}
                                        KB
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
