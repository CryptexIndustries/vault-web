import React, { useEffect, useRef, useState } from "react";
import { Body, Footer, GenericModal, Title } from "../general/modal";
import { ButtonFlat, ButtonType } from "../general/buttons";
import { Credential } from "../../app_lib/vault-utils";
import {
    DiffChange,
    DiffType,
    PartialCredential,
    Diff,
} from "../../app_lib/proto/vault";
import { WarningDialogShowFn } from "./warning";
import dayjs from "dayjs";
import { FormSelectboxField } from "../general/input-fields";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "react-toastify";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";

// enum SolveStrategy {
//     Manual,
//     Latest,
//     ThisVaultPriority,
//     OtherVaultPriority,
// }

enum DiffItemChoice {
    KeepOurs,
    KeepTheirs,
    KeepBoth,
    // KeepBoth,
    Remove,
    Keep,
}

export type ManualSyncShowDialogFnPropType = (
    ourCredentials: Credential.VaultCredential[],
    theirCredentials: PartialCredential[],
    onConfirm: OnSuccessCallback,
    onCancel: OnCancelCallback,
) => void;

type OnSuccessCallback = (
    diffsToApply: Diff[],
    diffsToSend: Diff[],
) => Promise<void>;
type OnCancelCallback = () => void;

export const ManualSynchronizationDialog: React.FC<{
    showDialogFnRef: React.RefObject<ManualSyncShowDialogFnPropType>;
    showWarningDialog: WarningDialogShowFn;
}> = ({ showDialogFnRef, showWarningDialog }) => {
    const [dialogVisible, setDialogVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const ourCredentialsRef = useRef<Credential.VaultCredential[]>([]);
    const theirCredentialsRef = useRef<Credential.VaultCredential[]>([]);
    const onSuccessRef = useRef<OnSuccessCallback>(undefined);
    const onCancelRef = useRef<OnCancelCallback>(undefined);

    const [differences, setDifferences] = useState<Diff[]>([]);
    // const [solveStrategy, setSolveStrategy] = useState(SolveStrategy.Manual);
    const diffItemSelection = useRef<Map<string, DiffItemChoice>>(new Map());

    showDialogFnRef.current = (
        ourCredentials: Credential.VaultCredential[],
        theirCredentials: PartialCredential[],
        onSuccess: OnSuccessCallback,
        onCancel: OnCancelCallback,
    ) => {
        ourCredentialsRef.current = ourCredentials;

        // NOTE: We need to convert the PartialCredential to a VaultCredential
        // This should work as long as the data we received is valid
        theirCredentialsRef.current =
            theirCredentials as Credential.VaultCredential[];

        onSuccessRef.current = onSuccess;
        onCancelRef.current = onCancel;

        compare();

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
            onSuccessRef.current = undefined;
            onCancelRef.current = undefined;
            diffItemSelection.current = new Map();
            setDifferences([]);
        }, 200);
    };

    // Determine the differences between the two sets of credentials
    // If the credentials IDs and hashes match, then the credentials are the same
    // If the credentials IDs match but the hashes don't, then we save that as a modification
    // If their credentials are not in our credentials, then we save that as an addition
    // If our credentials are not in their credentials, then we save that as removal
    const compare = async () => {
        setLoading(true);
        const _differences: Diff[] = [];

        for (const ourCredential of ourCredentialsRef.current) {
            const theirCredential = theirCredentialsRef.current.find(
                (theirCredential) => theirCredential.ID === ourCredential.ID,
            );

            // const ourHash = await ourCredential.hash();
            const ourCredentialParsed = Object.assign(
                new Credential.VaultCredential(),
                ourCredential,
            );
            const theirCredentialParsed = theirCredential
                ? Object.assign(
                      new Credential.VaultCredential(),
                      theirCredential,
                  )
                : null;

            // If we couldn't find the matching credential
            if (!theirCredentialParsed) {
                // Removal
                const item = {
                    Hash: await ourCredentialParsed.hash(),
                    Changes: {
                        Type: DiffType.Delete,
                        ID: ourCredentialParsed.ID,
                        Props: ourCredentialParsed,
                    },
                };

                _differences.push(item);

                onDiffItemChoiceChange(
                    item.Hash,
                    initialDiffItemState(item.Changes.Type),
                );

                // Stop processing the credential
                continue;
            }

            const ourHash = await ourCredentialParsed.hash();
            const theirHash = await theirCredentialParsed.hash();
            if (ourHash !== theirHash) {
                // Modification
                const _diff: Diff = {
                    Hash: theirHash,
                    Changes: {
                        Type: DiffType.Update,
                        ID: theirCredentialParsed.ID,
                        Props: theirCredentialParsed,
                    },
                };
                // TODO: Use this to show the changes in the UI
                if (_diff.Changes && _diff.Changes.Props)
                    _diff.Changes.Props.ChangeFlags = Credential.getChanges(
                        ourCredentialParsed,
                        theirCredentialParsed,
                    )?.Props?.ChangeFlags;

                if (_diff.Changes) {
                    _differences.push(_diff);

                    onDiffItemChoiceChange(
                        _diff.Hash,
                        initialDiffItemState(_diff.Changes.Type),
                    );
                }
            } else {
                // Same
            }
        }

        for (const theirCredential of theirCredentialsRef.current) {
            const ourCredential = ourCredentialsRef.current.find(
                (ourCredential) => ourCredential.ID === theirCredential.ID,
            );

            // If our version exists, stop processing this credential
            // We're only processing the additions here
            if (ourCredential) continue;

            const theirCredentialParsed = Object.assign(
                new Credential.VaultCredential(),
                theirCredential,
            );

            // Addition
            const item = {
                Hash: await theirCredentialParsed.hash(),
                Changes: {
                    Type: DiffType.Add,
                    ID: theirCredentialParsed.ID,
                    Props: theirCredentialParsed,
                },
            };
            _differences.push(item);

            onDiffItemChoiceChange(
                item.Hash,
                initialDiffItemState(item.Changes.Type),
            );
        }

        setDifferences(_differences);
        setLoading(false);
    };

    const initialDiffItemState = (diffType: DiffType): DiffItemChoice => {
        if (diffType === DiffType.Add || diffType === DiffType.Delete)
            return DiffItemChoice.Keep;

        return DiffItemChoice.KeepBoth;
    };

    const onDiffItemChoiceChange = (hash: string, choice: DiffItemChoice) => {
        diffItemSelection.current.set(hash, choice);
    };

    const onConfirm = async () => {
        setLoading(true);

        // Wait for a second to allow the loading spinner to show
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.debug(
            "[ManualSynchronizationDialog] Confirm",
            diffItemSelection.current,
            differences.map((i) => DiffType[i.Changes?.Type ?? DiffType.Add]),
        );

        const diffsToApply: Diff[] = [];
        const diffsToSend: Diff[] = [];

        for (const [changeHash, changeType] of diffItemSelection.current) {
            const diff = differences.find((i) => i.Hash === changeHash);

            if (!diff?.Changes) {
                console.warn(
                    "[ManualSynchronizationDialog] Came across a diff without changes. This should never happen.",
                );
                continue;
            }

            const theirCredential = theirCredentialsRef.current.find(
                (i) => i.ID === diff.Changes?.ID,
            );
            const ourCredential = ourCredentialsRef.current.find(
                (i) => i.ID === diff.Changes?.ID,
            );

            if (!theirCredential && !ourCredential) {
                // Hold yer horses!
                console.warn(
                    "[ManualSynchronizationDialog] Found a diff that is not present in either of the vaults. This should never happen.",
                );
                continue;
            }

            if (changeType === DiffItemChoice.Keep) {
                diff.Changes.Type = DiffType.Add;
                diff.Changes.Props = ourCredential ?? theirCredential;

                if (theirCredential) {
                    // Need to generate an "Add" diff for this vault
                    diffsToApply.push(diff);
                } else if (ourCredential) {
                    // Need to generate an "Add" diff for the other vault
                    diffsToSend.push(diff);
                }
            } else if (changeType === DiffItemChoice.Remove) {
                diff.Changes.Type = DiffType.Delete;
                diff.Changes.Props = undefined;

                if (theirCredential) {
                    // Need to send a "Remove" diff for the other vault
                    diffsToSend.push(diff);
                }

                if (ourCredential) {
                    // Need to send a "Remove" diff for this vault
                    diffsToApply.push(diff);
                }
            } else if (changeType === DiffItemChoice.KeepOurs) {
                if (!diff.Changes?.Props) {
                    console.warn(
                        "[ManualSynchronizationDialog] Modify diff had no Props.",
                    );
                    continue;
                }

                const c = Object.assign(diff.Changes.Props, ourCredential);
                diff.Changes.Props = c;

                diffsToSend.push(diff);
            } else if (changeType === DiffItemChoice.KeepTheirs) {
                if (!diff.Changes?.Props) {
                    console.warn(
                        "[ManualSynchronizationDialog] Modify diff had no Props.",
                    );
                    continue;
                }

                const c = Object.assign(diff.Changes.Props, theirCredential);
                diff.Changes.Props = c;

                diffsToApply.push(diff);
            } else if (changeType === DiffItemChoice.KeepBoth) {
                // Remove the item from both vaults
                diff.Changes.Type = DiffType.Delete;
                diff.Changes.Props = undefined;
                diffsToApply.push(diff);
                diffsToSend.push(diff);

                const craftDiff = async (
                    credential: Credential.VaultCredential,
                ) => {
                    let freshCredential = Object.assign({}, credential);

                    // Remove the ID from the credential so we generate a fresh one
                    freshCredential.ID = "";
                    freshCredential.Name = `${freshCredential.Name} [${dayjs(freshCredential.DateModified).toString()}]`;
                    freshCredential = new Credential.VaultCredential(
                        freshCredential,
                    );

                    // Generate a fresh diff skeleton
                    const newDiff = Object.assign({}, diff);
                    newDiff.Hash = await freshCredential.hash();

                    // Generate an addition diff
                    newDiff.Changes =
                        Credential.getChanges(undefined, freshCredential) ??
                        undefined;
                    return newDiff;
                };

                // Add our item to both vaults
                if (ourCredential) {
                    const newDiff = await craftDiff(ourCredential);
                    diffsToApply.push(newDiff);
                    diffsToSend.push(newDiff);
                }

                // Add their item to both vaults
                if (theirCredential) {
                    const newDiff = await craftDiff(theirCredential);
                    diffsToApply.push(newDiff);
                    diffsToSend.push(newDiff);
                }
            } else {
                console.error(
                    "[ManualSynchronizationDialog] Invalid diff item choice:",
                    changeType,
                    diff,
                );

                toast.error(
                    "Invalid diff item choice. This should never happen.",
                );
                setLoading(false);
                return;
            }
        }

        console.debug(
            "[ManualSynchronizationDialog] diffsToApply",
            diffsToApply.map((i) => DiffType[i.Changes?.Type ?? 0]),
        );

        console.debug(
            "[ManualSynchronizationDialog] diffsToSend",
            diffsToSend.map((i) => DiffType[i.Changes?.Type ?? 0]),
        );

        showWarningDialog(
            `You are about to apply ${diffsToApply.length} changes to this vault,
            and send ${diffsToSend.length} changes to the other device.`,
            async () => {
                await onSuccessRef.current?.(diffsToApply, diffsToSend);
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

    return (
        <GenericModal
            key="manual-synchronization-modal"
            visibleState={[dialogVisible, cancel]}
            childrenTitle={<Title>Manual synchronization</Title>}
        >
            <Body>
                <div className="flex flex-col">
                    <div className="mb-2 flex flex-col items-center gap-1 rounded-md border-2 border-yellow-400 p-4">
                        <ExclamationTriangleIcon
                            className="h-7 w-7 text-slate-800"
                            aria-hidden="true"
                        />
                        <p className="text-sm text-slate-700">
                            <span className="font-bold">
                                Detected {differences.length} simultaneous
                                changes to the vaults.
                            </span>
                        </p>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-slate-700">
                                Please decide what to do with the changes.
                            </p>
                            <p className="text-sm text-slate-700">
                                After your confirmation, the changes will be
                                applied to this, and the other device.
                            </p>
                        </div>
                    </div>
                    {/* TODO: Implement quick actions */}
                    <div className="flex flex-row items-start justify-between space-x-2 p-4 py-0">
                        {/* <p>Strategy</p>
                            <div className="flex space-x-2 text-sm">
                                <button
                                    className={clsx({
                                        "border border-slate-200":
                                            solveStrategy ===
                                            SolveStrategy.Manual,
                                    })}
                                    onClick={() =>
                                        setSolveStrategy(SolveStrategy.Manual)
                                    }
                                >
                                    Manual
                                </button>
                                <button
                                    className={clsx({
                                        "border border-slate-200":
                                            solveStrategy ===
                                            SolveStrategy.Latest,
                                    })}
                                    onClick={() =>
                                        setSolveStrategy(SolveStrategy.Latest)
                                    }
                                >
                                    Take Latest
                                </button>
                                <button
                                    className={clsx({
                                        "border border-slate-200":
                                            solveStrategy ===
                                            SolveStrategy.ThisVaultPriority,
                                    })}
                                    onClick={() =>
                                        setSolveStrategy(
                                            SolveStrategy.ThisVaultPriority,
                                        )
                                    }
                                >
                                    This Vault
                                </button>
                                <button
                                    className={clsx({
                                        "border border-slate-200":
                                            solveStrategy ===
                                            SolveStrategy.OtherVaultPriority,
                                    })}
                                    onClick={() =>
                                        setSolveStrategy(
                                            SolveStrategy.OtherVaultPriority,
                                        )
                                    }
                                >
                                    Other Vault
                                </button>
                            </div> */}
                    </div>
                    <div className="flex max-h-64 flex-col space-y-2 overflow-auto border border-slate-200 p-2">
                        {differences.map((diff, index) => {
                            if (!diff.Changes) return null;

                            return (
                                <DiffItem
                                    key={index}
                                    hash={diff.Hash}
                                    difference={diff.Changes}
                                    initialState={initialDiffItemState(
                                        diff.Changes.Type,
                                    )}
                                    onChangeFn={onDiffItemChoiceChange}
                                />
                            );
                        })}
                    </div>
                </div>
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Confirm"
                    className="sm:ml-2"
                    onClick={onConfirm}
                    disabled={loading}
                    loading={loading}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={cancel}
                    disabled={loading}
                />
            </Footer>
        </GenericModal>
    );
};

const DiffItem: React.FC<{
    hash: string;
    difference: DiffChange;
    initialState: DiffItemChoice;
    onChangeFn: (hash: string, action: DiffItemChoice) => void;
}> = ({ hash, difference, initialState, onChangeFn }) => {
    const diffType = difference.Type;
    const name = difference.Props?.Name ?? "Untitled";
    const username = difference.Props?.Username ?? "";

    const options: Record<number, string> = {};

    if (diffType === DiffType.Update) {
        options[DiffItemChoice.KeepOurs] = "Keep ours";
        options[DiffItemChoice.KeepTheirs] = "Keep theirs";
        options[DiffItemChoice.KeepBoth] = "Keep both";
        options[DiffItemChoice.Remove] = "Remove";
    } else {
        options[DiffItemChoice.Keep] = "Keep";
        options[DiffItemChoice.Remove] = "Remove";
    }

    const formSchema = z.object({
        Option: z.nativeEnum(DiffItemChoice),
    });
    type formSchemaType = z.infer<typeof formSchema>;
    const { control, register } = useForm<formSchemaType>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            Option: initialState,
        },
    });

    const selectedValue = useWatch({
        name: "Option",
        control: control,
        defaultValue: initialState,
    });

    useEffect(() => {
        // NOTE: Have to convert the string to a number as it gets passed as a string
        onChangeFn(hash, Number(selectedValue));
    }, [selectedValue]);

    return (
        <div
            className={
                "flex flex-col space-y-2 rounded border border-slate-400 px-3 py-2 shadow drop-shadow-sm transition-all hover:drop-shadow-md md:flex-row md:items-center md:space-x-2 md:space-y-2"
            }
        >
            <div className="flex flex-grow flex-col items-start text-start">
                <span
                    className="line-clamp-2 font-bold text-slate-800"
                    title={name}
                >
                    {name}
                </span>
                {username.length ? (
                    <span
                        className="line-clamp-1 text-sm text-slate-700"
                        title={username}
                    >
                        {username}
                    </span>
                ) : (
                    <span className="text-sm italic text-slate-700">
                        No username
                    </span>
                )}

                <span className="text-xs text-slate-600">
                    {
                        {
                            [DiffType["Delete"]]: "- Exists only in this vault",
                            [DiffType["Add"]]:
                                "- Exists only in the other vault",
                            [DiffType["Update"]]: "- Exists in both vaults",
                        }[diffType]
                    }
                </span>
            </div>
            <FormSelectboxField
                register={register("Option")}
                optionsEnum={options}
            ></FormSelectboxField>
        </div>
    );
};
