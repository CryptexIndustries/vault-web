import { useEffect, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { BackupDestinationStatus } from "@cryptex-industries/vault-core/vault-utils/backup-destination-scheduler";
import {
    createBackupDestinationRecord,
    updateBackupDestinationRecord,
    validateBackupDestinationInput,
    type BackupDestinationChange,
    type BackupDestinationField,
    type BackupDestinationInput,
} from "@cryptex-industries/vault-core/vault-utils/backup-destinations";
import { testBackupDestination } from "@cryptex-industries/vault-core/vault-utils/backup-destination-transfers";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";

/** What the destination UI needs from the app it runs in. */
export type BackupDestinationsController = {
    destinations: VaultUtilTypes.BackupDestination[];
    statuses: Record<string, BackupDestinationStatus>;
    save(change: BackupDestinationChange): Promise<void>;
    backupNow(destinationID: string): Promise<void>;
    describeError(error: unknown): string | null;
    docsUrl: string;
};

type Form = BackupDestinationInput;

const emptyForm = (): Form => ({
    Name: "",
    Endpoint: "",
    Region: "",
    Bucket: "",
    Prefix: "",
    PathStyle: false,
    AccessKeyID: "",
    SecretAccessKey: "",
    KeepAll: false,
});

const formFrom = (destination: VaultUtilTypes.BackupDestination): Form => ({
    Name: destination.Name,
    Endpoint: destination.Endpoint,
    Region: destination.Region,
    Bucket: destination.Bucket,
    Prefix: destination.Prefix,
    PathStyle: destination.PathStyle,
    AccessKeyID: destination.AccessKeyID,
    SecretAccessKey: destination.SecretAccessKey,
    KeepAll: destination.KeepAll,
});

/** Adds or edits one destination. Saving tests the connection first. */
export function BackupDestinationDialog({
    controller,
    destination,
    onOpenChange,
}: {
    controller: BackupDestinationsController;
    /** "new" to add one; null keeps the dialog closed. */
    destination: VaultUtilTypes.BackupDestination | "new" | null;
    onOpenChange: (open: boolean) => void;
}) {
    const [form, setForm] = useState<Form>(emptyForm);
    const [fieldError, setFieldError] = useState<{
        field: BackupDestinationField;
        message: string;
    } | null>(null);
    const [testError, setTestError] = useState("");
    const [busy, setBusy] = useState<"testing" | "saving" | null>(null);
    const removedElsewhere =
        destination !== "new" &&
        destination != null &&
        controller.destinations.some(
            (current) => current.ID === destination.ID && current.Deleted,
        );

    useEffect(() => {
        if (!destination) return;
        setForm(destination === "new" ? emptyForm() : formFrom(destination));
        setFieldError(null);
        setTestError("");
    }, [destination]);

    const set = <K extends keyof Form>(key: K, value: Form[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
        setFieldError(null);
        setTestError("");
    };

    const save = async (skipTest: boolean) => {
        if (!destination) return;
        if (removedElsewhere) {
            onOpenChange(false);
            toast.error("This destination was removed on another device.");
            return;
        }
        const validation = validateBackupDestinationInput(form);
        if (!validation.ok) {
            setFieldError(validation);
            return;
        }
        const record =
            destination === "new"
                ? createBackupDestinationRecord(validation.value)
                : updateBackupDestinationRecord(destination, validation.value);

        if (!skipTest) {
            setBusy("testing");
            try {
                await testBackupDestination(record);
            } catch (error) {
                setTestError(
                    controller.describeError(error) ??
                        "The connection test failed.",
                );
                setBusy(null);
                return;
            }
        }

        setBusy("saving");
        try {
            await controller.save(
                destination === "new"
                    ? { type: "add", record }
                    : { type: "edit", id: record.ID, input: validation.value },
            );
        } catch {
            toast.error("Couldn't save the destination.");
            setBusy(null);
            return;
        }
        setBusy(null);
        onOpenChange(false);
        toast.success(
            destination === "new" ? "Destination added" : "Destination saved",
        );
        void controller.backupNow(record.ID).catch(() => undefined);
    };

    const remove = async () => {
        if (!destination || destination === "new") return;
        setBusy("saving");
        try {
            await controller.save({ type: "remove", id: destination.ID });
            onOpenChange(false);
            toast.success(
                "Destination removed. Its backups stay in the bucket.",
            );
        } catch {
            toast.error("Couldn't remove the destination.");
        } finally {
            setBusy(null);
        }
    };

    const field = (
        key:
            | "Name"
            | "Endpoint"
            | "Region"
            | "Bucket"
            | "Prefix"
            | "AccessKeyID",
        label: string,
        props: ComponentProps<typeof Input> = {},
    ) => (
        <div className="space-y-1.5">
            <Label htmlFor={`backup-destination-${key}`}>{label}</Label>
            <Input
                id={`backup-destination-${key}`}
                value={form[key]}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={fieldError?.field === key}
                onChange={(event) => set(key, event.target.value)}
                {...props}
            />
            {fieldError?.field === key ? (
                <p className="text-sm text-destructive" role="alert">
                    {fieldError.message}
                </p>
            ) : null}
        </div>
    );

    return (
        <Dialog
            open={destination != null}
            onOpenChange={(next) => {
                if (!busy) onOpenChange(next);
            }}
        >
            <DialogContent
                className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
                data-testid="backup-destination-dialog"
            >
                <DialogHeader>
                    <DialogTitle>
                        {destination === "new"
                            ? "Add backup destination"
                            : "Edit backup destination"}
                    </DialogTitle>
                    <DialogDescription>
                        An S3-compatible bucket. The keys are saved in your
                        vault and used by each of your devices.{" "}
                        <a
                            href={controller.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                        >
                            Setup guide
                        </a>
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {field("Name", "Name", { placeholder: "Home NAS" })}
                    {field("Endpoint", "Endpoint", {
                        placeholder: "https://s3.eu-central-1.amazonaws.com",
                        inputMode: "url",
                    })}
                    <div className="grid gap-4 sm:grid-cols-2">
                        {field("Bucket", "Bucket")}
                        {field("Region", "Region", {
                            placeholder: "us-east-1",
                        })}
                    </div>
                    {field("Prefix", "Folder (optional)", {
                        placeholder: "cryptex-vault/",
                    })}
                    <div className="flex items-center justify-between gap-4">
                        <Label
                            htmlFor="backup-destination-PathStyle"
                            className="leading-snug"
                        >
                            Path-style addresses
                            <span className="block text-xs font-normal text-muted-foreground">
                                Needed for MinIO, Garage and most self-hosted
                                servers.
                            </span>
                        </Label>
                        <Switch
                            id="backup-destination-PathStyle"
                            checked={form.PathStyle}
                            onCheckedChange={(checked) =>
                                set("PathStyle", checked)
                            }
                        />
                    </div>
                    {field("AccessKeyID", "Access key ID")}
                    <div className="space-y-1.5">
                        <Label htmlFor="backup-destination-SecretAccessKey">
                            Secret access key
                        </Label>
                        <PasswordInput
                            id="backup-destination-SecretAccessKey"
                            value={form.SecretAccessKey}
                            secretLabel="secret access key"
                            autoComplete="off"
                            aria-invalid={
                                fieldError?.field === "SecretAccessKey"
                            }
                            onChange={(event) =>
                                set("SecretAccessKey", event.target.value)
                            }
                        />
                        {fieldError?.field === "SecretAccessKey" ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {fieldError.message}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <Label
                            htmlFor="backup-destination-KeepAll"
                            className="leading-snug"
                        >
                            Keep every backup
                            <span className="block text-xs font-normal text-muted-foreground">
                                Leaves clean-up to the bucket&apos;s own rules.
                                The key then needs no delete permission.
                            </span>
                        </Label>
                        <Switch
                            id="backup-destination-KeepAll"
                            checked={form.KeepAll}
                            onCheckedChange={(checked) =>
                                set("KeepAll", checked)
                            }
                        />
                    </div>
                    {form.KeepAll ? null : (
                        <p className="text-xs text-muted-foreground">
                            Each device keeps its backups from the last day, one
                            a day for a month and one a month for a year, and
                            deletes the rest.
                        </p>
                    )}
                    {testError ? (
                        <p className="text-sm text-destructive" role="alert">
                            {testError}
                        </p>
                    ) : null}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {destination && destination !== "new" ? (
                        <Button
                            variant="destructive"
                            disabled={busy != null}
                            onClick={() => void remove()}
                        >
                            Remove
                        </Button>
                    ) : null}
                    {testError ? (
                        <Button
                            variant="outline"
                            disabled={busy != null}
                            onClick={() => void save(true)}
                        >
                            Save anyway
                        </Button>
                    ) : null}
                    <Button
                        data-testid="backup-destination-save"
                        disabled={busy != null}
                        onClick={() => void save(false)}
                    >
                        {busy === "testing"
                            ? "Testing connection…"
                            : busy === "saving"
                              ? "Saving…"
                              : "Test and save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
