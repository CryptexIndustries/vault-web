import { Database, Pencil, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { BackupDestinationStatus } from "@cryptex-industries/vault-core/vault-utils/backup-destination-scheduler";
import { visibleBackupDestinations } from "@cryptex-industries/vault-core/vault-utils/backup-destinations";

import { formatBackupAge } from "@/app_lib/backup-status";
import {
    BackupDestinationDialog,
    type BackupDestinationsController,
} from "@/components/vault-dashboard/backup-destination-dialog";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const hostOf = (endpoint: string) => {
    try {
        return new URL(endpoint).host;
    } catch {
        return endpoint;
    }
};

function statusText(status: BackupDestinationStatus | undefined): {
    text: string;
    error?: boolean;
} {
    if (!status) return { text: "Checking…" };
    if (status.phase === "paused") return { text: "Paused" };
    if (status.phase === "uploading") return { text: "Uploading…" };
    if (status.phase === "error" && status.lastError) {
        const retry = status.retryAt
            ? ` Retrying in ${Math.max(1, Math.ceil((status.retryAt - Date.now()) / 60_000))} min.`
            : "";
        return { text: `${status.lastError.message}${retry}`, error: true };
    }
    const last = status.lastSuccessAt
        ? `Last backup ${formatBackupAge(new Date(status.lastSuccessAt))}`
        : "No backup yet";
    return {
        text:
            status.phase === "scheduled"
                ? `${last}. Changes waiting to upload.`
                : `${last}.`,
    };
}

function DestinationRow({
    controller,
    destination,
    onEdit,
}: {
    controller: BackupDestinationsController;
    destination: VaultUtilTypes.BackupDestination;
    onEdit: () => void;
}) {
    const [backingUp, setBackingUp] = useState(false);
    const status = controller.statuses[destination.ID];
    const { text, error } = statusText(status);

    const backUpNow = async () => {
        setBackingUp(true);
        try {
            await controller.backupNow(destination.ID);
            toast.success(`Backed up to ${destination.Name}`);
        } catch (cause) {
            toast.error(
                controller.describeError(cause) ??
                    "The backup couldn't be created.",
            );
        } finally {
            setBackingUp(false);
        }
    };

    const setPaused = async (paused: boolean) => {
        try {
            await controller.save({
                type: "pause",
                id: destination.ID,
                paused,
            });
        } catch {
            toast.error("Couldn't save the change.");
        }
    };

    return (
        <div
            className="space-y-2 rounded-md border p-3"
            data-testid="backup-destination-row"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate font-medium">{destination.Name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {destination.Bucket} on {hostOf(destination.Endpoint)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        checked={!destination.Paused}
                        aria-label={`Automatic backups to ${destination.Name}`}
                        onCheckedChange={(checked) => void setPaused(!checked)}
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={backingUp || destination.Paused}
                        onClick={() => void backUpNow()}
                    >
                        <RefreshCw
                            className={
                                backingUp
                                    ? "mr-2 h-4 w-4 animate-spin"
                                    : "mr-2 h-4 w-4"
                            }
                        />
                        Back up now
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${destination.Name}`}
                        onClick={onEdit}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <p
                className={
                    error
                        ? "text-sm text-destructive"
                        : "text-sm text-muted-foreground"
                }
                role={error ? "alert" : undefined}
            >
                {text}
            </p>
            {status?.pruneError && status.phase !== "error" ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                    Couldn&apos;t remove old backups: {status.pruneError}
                </p>
            ) : null}
        </div>
    );
}

export function BackupDestinationsCard({
    controller,
}: {
    controller: BackupDestinationsController;
}) {
    const destinations = visibleBackupDestinations(controller.destinations);
    const [editing, setEditing] = useState<
        VaultUtilTypes.BackupDestination | "new" | null
    >(null);

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Database className="h-4 w-4" />
                            Your own storage
                        </CardTitle>
                        <CardDescription className="mt-1">
                            Each device uploads an encrypted .cryx file to S3
                            buckets you control after every change. The bucket
                            keys stay in your vault.
                        </CardDescription>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing("new")}
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Add destination
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {destinations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Works with AWS S3, Backblaze B2, Cloudflare R2, Wasabi,
                        MinIO, Garage and other S3-compatible storage.
                    </p>
                ) : (
                    destinations.map((destination) => (
                        <DestinationRow
                            key={destination.ID}
                            controller={controller}
                            destination={destination}
                            onEdit={() => setEditing(destination)}
                        />
                    ))
                )}
            </CardContent>
            <BackupDestinationDialog
                controller={controller}
                destination={editing}
                onOpenChange={(open) => {
                    if (!open) setEditing(null);
                }}
            />
        </Card>
    );
}
