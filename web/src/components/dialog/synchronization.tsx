import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    VaultCredential,
} from "../../app_lib/vault-utils/vault";
// import {
//     DiffChange,
//     DiffType,
//     Diff,
// } from "../../app_lib/proto/vault";
import { WarningDialogShowFn } from "./warning";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { ManualConflictResolutionData, ManualConflictResolutionDialogData, ManualSyncItemOption } from "@/app_lib/synchronization-utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../ui/accordion";
import { Loader2 } from "lucide-react";
import dayjs from "dayjs";

// enum SolveStrategy {
//     Manual,
//     Latest,
//     ThisVaultPriority,
//     OtherVaultPriority,
// }

export type ManualSyncShowDialogFnPropType = (
    data: ManualConflictResolutionDialogData,
    onConfirm: OnConfirmCallback,
    onCancel: OnCancelCallback,
) => void;

type OnConfirmCallback = (
    data: ManualConflictResolutionData,
) => Promise<void>;
type OnCancelCallback = () => void;

export const ManualSynchronizationDialog: React.FC<{
    showDialogFnRef: React.RefObject<ManualSyncShowDialogFnPropType>;
    showWarningDialog: WarningDialogShowFn;
}> = ({ showDialogFnRef, showWarningDialog }) => {
    const [dialogVisible, setDialogVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const ourCredentialsRef = useRef<VaultCredential[]>([]);
    const theirCredentialsRef = useRef<VaultCredential[]>([]);
    const onConfirmRef = useRef<OnConfirmCallback>(undefined);
    const onCancelRef = useRef<OnCancelCallback>(undefined);

    // const [differences, setDifferences] = useState<Diff[]>([]);
    // const [solveStrategy, setSolveStrategy] = useState(SolveStrategy.Manual);
    const diffItemSelection = useRef<Map<string, ManualSyncItemOption>>(new Map());

    showDialogFnRef.current = (
        data: ManualConflictResolutionDialogData,
        onSuccess: OnConfirmCallback,
        onCancel: OnCancelCallback,
    ) => {
        ourCredentialsRef.current = data.ourCredentials;
        theirCredentialsRef.current = data.theirCredentials;
        diffItemSelection.current = data.dialogList;

        onConfirmRef.current = onSuccess;
        onCancelRef.current = onCancel;

        // setDifferences(data.diffs);
        setDialogVisible(true);
    };

    const hideDialog = (force = false) => {
        if ((loading || diffItemSelection.current.size) && !force) {
            const hide = window.confirm(
                "Are you sure you want to cancel? This will discard all changes.",
            );

            if (!hide) return;
        }
        setDialogVisible(false);

        // Call the cancel callback
        if (!force) onCancelRef.current?.();

        setTimeout(() => {
            setLoading(false);
            ourCredentialsRef.current = [];
            theirCredentialsRef.current = [];
            onConfirmRef.current = undefined;
            onCancelRef.current = undefined;
            diffItemSelection.current = new Map();
            // setDifferences([]);
        }, 200);
    };

    const onDiffItemChoiceChange = (hash: string, choice: ManualSyncItemOption) => {
        diffItemSelection.current.set(hash, choice);
    };

    const onConfirm = async () => {
        setLoading(true);

        // Wait for a second to allow the loading spinner to show
        await new Promise((resolve) => setTimeout(resolve, 100));

        showWarningDialog(
            "Are you sure you want to apply these changes?",
            async () => {
                // await onConfirmRef.current?.({
                //     ourCredentials: ourCredentialsRef.current,
                //     theirCredentials: theirCredentialsRef.current,
                //     differences: differences,
                //     userChoices: diffItemSelection.current,
                // });
                hideDialog(true);
            },
            () => {
                setLoading(false);
            },
        );
    };

    const cancel = () => {
        hideDialog();
    };

    // const diffItems = useMemo(
    //     () =>
    //         differences.filter(
    //             (diff): diff is Diff & { Changes: DiffChange } =>
    //                 Boolean(diff.Changes),
    //         ),
    //     [differences],
    // );

    // const ourCredentialsById = useMemo(() => {
    //     return new Map(
    //         ourCredentialsRef.current.map((credential) => [
    //             credential.ID,
    //             credential,
    //         ]),
    //     );
    // }, [differences, dialogVisible]);

    // const theirCredentialsById = useMemo(() => {
    //     return new Map(
    //         theirCredentialsRef.current.map((credential) => [
    //             credential.ID,
    //             credential,
    //         ]),
    //     );
    // }, [differences, dialogVisible]);

    // const changeSummary = useMemo(() => {
    //     const summary = { add: 0, update: 0, remove: 0, total: 0 };
    //     diffItems.forEach((diff) => {
    //         summary.total += 1;
    //         switch (diff.Changes.Type) {
    //             case DiffType.Add:
    //                 summary.add += 1;
    //                 break;
    //             case DiffType.Update:
    //                 summary.update += 1;
    //                 break;
    //             case DiffType.Delete:
    //                 summary.remove += 1;
    //                 break;
    //             default:
    //                 break;
    //         }
    //     });
    //     return summary;
    // }, [diffItems]);
    return null;
    /* return (
        <Dialog open={dialogVisible} onOpenChange={(open) => !open && cancel()}>
            <DialogContent className="max-h-[90vh] w-[96vw] max-w-[960px] overflow-y-auto sm:overflow-hidden">
                <DialogHeader className="space-y-2 text-left">
                    <DialogTitle>Manual synchronization</DialogTitle>
                    <DialogDescription>
                        Review each change and choose which version to keep.
                        Your selections apply to both devices.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <Alert className="border-amber-500/40 bg-amber-50 text-amber-900">
                        <ExclamationTriangleIcon className="h-5 w-5" />
                        <AlertTitle>Conflicts detected</AlertTitle>
                        <AlertDescription>
                            Detected {changeSummary.total} simultaneous changes.
                            Resolve each entry before applying updates.
                        </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                            {changeSummary.total} total
                        </Badge>
                        <Badge variant="outline">
                            {changeSummary.update} updated
                        </Badge>
                        <Badge variant="outline">
                            {changeSummary.add} added
                        </Badge>
                        <Badge variant="outline">
                            {changeSummary.remove} removed
                        </Badge>
                    </div>
                    <Card className="overflow-hidden">
                        <div className="flex items-center justify-between border-b px-3 py-2 sm:px-4 sm:py-3">
                            <div>
                                <p className="text-sm font-semibold">
                                    Changes
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Choose an action for each entry.
                                </p>
                            </div>
                            <Badge variant="secondary">
                                {diffItems.length}
                            </Badge>
                        </div>
                        <div className="max-h-[35vh] space-y-3 overflow-y-auto p-2 sm:max-h-[45vh] sm:p-3">
                            {diffItems.length ? (
                                diffItems.map((diff, index) => (
                                    <DiffItem
                                        key={index}
                                        hash={diff.Hash}
                                        difference={diff.Changes}
                                        ourCredential={ourCredentialsById.get(
                                            diff.Changes.ID,
                                        )}
                                        theirCredential={theirCredentialsById.get(
                                            diff.Changes.ID,
                                        )}
                                        initialState={
                                            diffItemSelection.current.get(
                                                diff.Hash,
                                            ) ?? null
                                        }
                                        onChangeFn={onDiffItemChoiceChange}
                                    />
                                ))
                            ) : (
                                <div className="flex flex-col items-center gap-1 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    No changes to resolve.
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
                <DialogFooter className="gap-2 sm:gap-3">
                    <Button
                        variant="secondary"
                        onClick={cancel}
                        disabled={loading}
                        className="w-full sm:w-auto"
                    >
                        Close
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={loading || diffItems.length === 0}
                        className="w-full sm:min-w-[160px] sm:w-auto"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Applying...
                            </>
                        ) : (
                            "Apply changes"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    ); */
};

// type CredentialLike = VaultCredential | NonNullable<DiffChange["Props"]>;

/* const DiffItem: React.FC<{
    hash: string;
    difference: DiffChange;
    ourCredential?: VaultCredential;
    theirCredential?: VaultCredential;
    initialState: ManualSyncItemOption | null;
    onChangeFn: (hash: string, action: ManualSyncItemOption) => void;
}> = ({
    hash,
    difference,
    ourCredential,
    theirCredential,
    initialState,
    onChangeFn,
}) => {
    const diffType = difference.Type;
    const name = difference.Props?.Name ?? "Untitled";
    const username = difference.Props?.Username ?? "";

    const options: Record<number, string> = {};
    let defaultValue = ManualSyncItemOption.KeepBoth;

    if (diffType === DiffType.Update) {
        options[ManualSyncItemOption.KeepOurs] = "Keep ours";
        options[ManualSyncItemOption.KeepTheirs] = "Keep theirs";
        options[ManualSyncItemOption.KeepBoth] = "Keep both";
        options[ManualSyncItemOption.Remove] = "Remove";

        defaultValue = initialState ?? ManualSyncItemOption.KeepBoth;
    } else {
        options[ManualSyncItemOption.Keep] = "Keep";
        options[ManualSyncItemOption.Remove] = "Remove";

        defaultValue = initialState ?? ManualSyncItemOption.Keep;
    }

    const formSchema = z.object({
        Option: z.nativeEnum(ManualSyncItemOption),
    });
    type formSchemaType = z.infer<typeof formSchema>;
    const { control, register } = useForm<formSchemaType>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            Option: defaultValue,
        },
    });

    const selectedValue = useWatch({
        name: "Option",
        control: control,
        defaultValue: defaultValue,
    });

    useEffect(() => {
        // NOTE: Have to convert the string to a number as it gets passed as a string
        onChangeFn(hash, Number(selectedValue));
    }, [hash, onChangeFn, selectedValue]);

    const diffLabel = {
        [DiffType["Delete"]]: "Only in this vault",
        [DiffType["Add"]]: "Only in the other vault",
        [DiffType["Update"]]: "In both vaults",
    }[diffType];

    const diffBadge = {
        [DiffType["Delete"]]: "This vault",
        [DiffType["Add"]]: "Other vault",
        [DiffType["Update"]]: "Conflict",
    }[diffType];

    const changeFlags = difference.Props?.ChangeFlags;
    const diffFields = getDiffFields(diffType, changeFlags);

    const leftCredential: CredentialLike | undefined =
        diffType === DiffType.Add ? undefined : ourCredential;
    const rightCredential: CredentialLike | undefined =
        diffType === DiffType.Delete
            ? undefined
            : (theirCredential ?? difference.Props);

    return (
        <Card className="rounded-lg border border-border/70 p-3 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="line-clamp-2 font-semibold" title={name}>
                            {name}
                        </span>
                        <Badge variant="outline">{diffBadge}</Badge>
                    </div>
                    {username.length ? (
                        <span
                            className="line-clamp-1 text-sm text-muted-foreground"
                            title={username}
                        >
                            {username}
                        </span>
                    ) : (
                        <span className="text-sm italic text-muted-foreground">
                            No username
                        </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                        {diffLabel}
                    </span>
                </div>
                <div className="w-full sm:w-56">
                    <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                        Action
                    </span>
                    <Controller
                        control={control}
                        name="Option"
                        render={({ field }) => (
                            <Select
                                value={String(field.value)}
                                onValueChange={(value) =>
                                    field.onChange(Number(value))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose action" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(options).map(
                                        ([key, label]) => (
                                            <SelectItem
                                                key={key}
                                                value={key}
                                            >
                                                {label}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </div>
            </div>
            <Accordion type="single" collapsible className="mt-3">
                <AccordionItem value={`diff-${hash}`} className="border-none hover:border-border/70">
                    <AccordionTrigger className="py-2 text-xs font-semibold uppercase text-muted-foreground hover:no-underline">
                        View differences
                    </AccordionTrigger>
                    <AccordionContent className="pt-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <CredentialDiffColumn
                                title="This vault"
                                credential={leftCredential}
                                fields={diffFields}
                            />
                            <CredentialDiffColumn
                                title="Other vault"
                                credential={rightCredential}
                                fields={diffFields}
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </Card>
    );
};

type ChangeFlags = NonNullable<NonNullable<DiffChange["Props"]>["ChangeFlags"]>;

type DiffFieldKey =
    | "Name"
    | "Username"
    | "Password"
    | "URL"
    | "Notes"
    | "Tags"
    | "TOTP"
    | "CustomFields"
    | "Metadata";

type DiffField = {
    key: DiffFieldKey;
    label: string;
};

const FIELD_LABELS: Record<DiffFieldKey, string> = {
    Name: "Name",
    Username: "Username",
    Password: "Password",
    URL: "Website",
    Notes: "Notes",
    Tags: "Tags",
    TOTP: "TOTP",
    CustomFields: "Custom fields",
    Metadata: "Metadata",
};

const DEFAULT_FIELDS: DiffFieldKey[] = [
    "Name",
    "Username",
    "URL",
    "Tags",
    "Notes",
];

const FLAG_TO_FIELD: Record<keyof ChangeFlags, DiffFieldKey> = {
    TypeHasChanged: "Metadata",
    GroupIDHasChanged: "Metadata",
    NameHasChanged: "Name",
    UsernameHasChanged: "Username",
    PasswordHasChanged: "Password",
    TOTPHasChanged: "TOTP",
    TagsHasChanged: "Tags",
    URLHasChanged: "URL",
    NotesHasChanged: "Notes",
    DateCreatedHasChanged: "Metadata",
    DateModifiedHasChanged: "Metadata",
    DatePasswordChangedHasChanged: "Metadata",
    CustomFieldsHasChanged: "CustomFields",
};

const getDiffFields = (
    diffType: DiffType,
    changeFlags?: ChangeFlags,
): DiffField[] => {
    if (diffType !== DiffType.Update || !changeFlags) {
        return DEFAULT_FIELDS.map((key) => ({
            key,
            label: FIELD_LABELS[key],
        }));
    }

    const changedKeys = Object.entries(changeFlags)
        .filter(([, value]) => Boolean(value))
        .map(([flag]) => FLAG_TO_FIELD[flag as keyof ChangeFlags])
        .filter((key): key is DiffFieldKey => Boolean(key));

    const uniqueKeys = Array.from(new Set(changedKeys));
    const keys = uniqueKeys.length ? uniqueKeys : DEFAULT_FIELDS;

    return keys.map((key) => ({ key, label: FIELD_LABELS[key] }));
};

const CredentialDiffColumn: React.FC<{
    title: string;
    credential?: CredentialLike;
    fields: DiffField[];
}> = ({ title, credential, fields }) => {
    return (
        <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
                {title}
            </p>
            <div className="mt-2 space-y-2">
                {credential ? (
                    fields.map((field) => (
                        <CredentialFieldRow
                            key={field.key}
                            label={field.label}
                            value={formatCredentialValue(credential, field.key)}
                        />
                    ))
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Not present.
                    </p>
                )}
            </div>
        </div>
    );
};

const CredentialFieldRow: React.FC<{
    label: string;
    value: string;
}> = ({ label, value }) => (
    <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm break-words whitespace-pre-wrap">
            {value || "-"}
        </p>
    </div>
);

const formatCredentialValue = (
    credential: CredentialLike | undefined,
    key: DiffFieldKey,
): string => {
    if (!credential) return "-";
    switch (key) {
        case "Name":
            return credential.Name || "-";
        case "Username":
            return credential.Username || "-";
        case "Password":
            return credential.Password ? "Hidden" : "-";
        case "URL":
            return credential.URL || "-";
        case "Notes":
            return credential.Notes || "-";
        case "Tags":
            return credential.Tags || "-";
        case "TOTP":
            return credential.TOTP
                ? `${credential.TOTP.Label || "TOTP"} · ${credential.TOTP.Period}s`
                : "-";
        case "CustomFields":
            return credential.CustomFields?.length
                ? `${credential.CustomFields.length} fields`
                : "-";
        case "Metadata": {
            const details = [
                credential.DateCreated
                    ? `Created: ${dayjs(credential.DateCreated).toString()}`
                    : null,
                credential.DateModified
                    ? `Updated: ${dayjs(credential.DateModified).toString()}`
                    : null,
                credential.DatePasswordChanged
                    ? `Password: ${dayjs(credential.DatePasswordChanged).toString()}`
                    : null,
            ].filter(Boolean);
            return details.length ? details.join("\n") : "-";
        }
        default:
            return "-";
    }
};
 */