import React, { useState } from "react";
import { Body, Footer, GenericModal } from "../general/modal";
import { ButtonFlat, ButtonType } from "../general/buttons";
import { Credential } from "../../app_lib/vault_utils";
import { DiffType } from "../../app_lib/proto/vault";
import clsx from "clsx";
import { WarningDialogShowFn } from "./warning";

export type DivergenceSolveShowDialogFnPropType = (
    ourCredentials: Credential.VaultCredential[],
    theirCredentials: Credential.VaultCredential[],
    onSuccess: OnSuccessCallback,
    onCancel: OnCancelCallback
) => void;

type OnSuccessCallback = (
    diffsToApply: Credential.Diff[],
    diffsToSend: Credential.Diff[]
) => Promise<void>;
type OnCancelCallback = () => void;

export const DivergenceSolveDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<DivergenceSolveShowDialogFnPropType | null>;
    showWarningDialog: WarningDialogShowFn;
}> = ({ showDialogFnRef, showWarningDialog }) => {
    const [dialogVisible, setDialogVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const ourCredentialsRef = React.useRef<Credential.VaultCredential[]>([]);
    const theirCredentialsRef = React.useRef<Credential.VaultCredential[]>([]);
    const onSuccessRef = React.useRef<OnSuccessCallback>();
    const onCancelRef = React.useRef<OnCancelCallback>();

    const [selectedDiffHashes, setSelectedDiffHashes] = useState<string[]>([]);
    const [differences, setDifferences] = useState<Credential.Diff[]>([]);

    showDialogFnRef.current = (
        ourCredentials: Credential.VaultCredential[],
        theirCredentials: Credential.VaultCredential[],
        onSuccess: OnSuccessCallback,
        onCancel: OnCancelCallback
    ) => {
        ourCredentialsRef.current = ourCredentials;
        theirCredentialsRef.current = theirCredentials;
        onSuccessRef.current = onSuccess;
        onCancelRef.current = onCancel;

        compare();

        setDialogVisible(true);
    };

    const hideDialog = (force = false) => {
        if ((loading || selectedDiffHashes.length) && !force) {
            const hide = window.confirm(
                "Are you sure you want to cancel? This will discard all changes."
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
            setSelectedDiffHashes([]);
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
        const _differences: Credential.Diff[] = [];

        for (const ourCredential of ourCredentialsRef.current) {
            const theirCredential = theirCredentialsRef.current.find(
                (theirCredential) => theirCredential.ID === ourCredential.ID
            );

            // const ourHash = await ourCredential.hash();
            const parsedOurCredential = Object.assign(
                new Credential.VaultCredential(),
                ourCredential
            );
            const parsedTheirCredential = theirCredential
                ? Object.assign(
                      new Credential.VaultCredential(),
                      theirCredential
                  )
                : null;

            if (parsedTheirCredential) {
                const ourHash = await parsedOurCredential.hash();
                const theirHash = await parsedTheirCredential.hash();
                if (ourHash !== theirHash) {
                    // Modification
                    _differences.push({
                        Hash: theirHash,
                        Changes: {
                            Type: DiffType.Update,
                            ID: parsedTheirCredential.ID,
                            Props: parsedTheirCredential,
                        },
                    });
                } else {
                    // Same
                }
            } else {
                // Removal
                _differences.push({
                    Hash: await parsedOurCredential.hash(),
                    Changes: {
                        Type: DiffType.Delete,
                        ID: parsedOurCredential.ID,
                        Props: parsedOurCredential,
                    },
                });
            }
        }

        for (const theirCredential of theirCredentialsRef.current) {
            const ourCredential = ourCredentialsRef.current.find(
                (ourCredential) => ourCredential.ID === theirCredential.ID
            );

            const parsedTheirCredential = Object.assign(
                new Credential.VaultCredential(),
                theirCredential
            );

            if (!ourCredential) {
                // Addition
                _differences.push({
                    Hash: await parsedTheirCredential.hash(),
                    Changes: {
                        Type: DiffType.Add,
                        ID: parsedTheirCredential.ID,
                        Props: parsedTheirCredential,
                    },
                });
            }
        }

        setDifferences(_differences);
        setLoading(false);
    };

    const numberOfAdditions = differences.filter(
        (diff) => diff.Changes?.Type === DiffType.Add
    ).length;
    const numberOfModifications = differences.filter(
        (diff) => diff.Changes?.Type === DiffType.Update
    ).length;
    const numberOfDeletions = differences.filter(
        (diff) => diff.Changes?.Type === DiffType.Delete
    ).length;

    const selectAll = (checked: boolean) => {
        if (!checked) {
            setSelectedDiffHashes([]);
        } else {
            setSelectedDiffHashes(differences.map((diff) => diff.Hash));
        }
    };

    const selectDiff = (hash: string, checked: boolean) => {
        if (!checked) {
            setSelectedDiffHashes(selectedDiffHashes.filter((h) => h !== hash));
        } else {
            setSelectedDiffHashes([...selectedDiffHashes, hash]);
        }
    };

    const onConfirm = async () => {
        setLoading(true);

        // Wait for a second to allow the loading spinner to show
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.debug(
            "DivergenceSolveDialog confirm",
            selectedDiffHashes,
            differences.map((i) => DiffType[i.Changes?.Type ?? 0])
        );

        const diffsToApply: Credential.Diff[] = [];
        const diffsToSend: Credential.Diff[] = [];

        for (const _diff of differences) {
            const diffType = _diff.Changes?.Type ?? 0;

            const diff = JSON.parse(JSON.stringify(_diff));

            // Changes cannot be undefined
            if (!diff.Changes) {
                continue;
            }

            if (selectedDiffHashes.includes(diff.Hash)) {
                if (diffType === DiffType.Add) {
                    diffsToApply.push(diff);
                } else if (diffType === DiffType.Update) {
                    diffsToApply.push(diff);
                } else if (diffType === DiffType.Delete) {
                    diff.Changes.Props = undefined;
                    diffsToApply.push(diff);
                }
            } else {
                if (diffType === DiffType.Add) {
                    // If the user didn't select this "Addition" diff, then we need to send it to the other device as a removal
                    diff.Changes.Type = DiffType.Delete;
                    diff.Changes.Props = undefined;
                    diffsToSend.push(diff);
                } else if (diffType === DiffType.Update) {
                    // If the user didn't select this "Modification" diff, then we need to send our version of the credential to the other device
                    const ourCredential = ourCredentialsRef.current.find(
                        (ourCredential) => ourCredential.ID === diff.Changes?.ID
                    );
                    if (ourCredential) {
                        diff.Changes.Props = ourCredential;
                        diffsToSend.push(diff);
                    } else {
                        console.error(
                            "[DivergenceSolveDialog] Could not find our version of the credential for this modification diff (this should never happen)",
                            diff
                        );
                    }
                } else if (diffType === DiffType.Delete) {
                    // If the user didn't select this "Removal" diff, then we need to send it to the other device as an addition
                    diff.Changes.Type = DiffType.Add;
                    diffsToSend.push(diff);
                }
            }
        }

        console.debug(
            "diffsToApply",
            diffsToApply.map((i) => DiffType[i.Changes?.Type ?? 0])
        );

        console.debug(
            "diffsToSend",
            diffsToSend.map((i) => DiffType[i.Changes?.Type ?? 0])
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
            }
        );
    };

    const cancel = () => {
        hideDialog();
    };

    return (
        <GenericModal
            key="divergence-solver-modal"
            visibleState={[dialogVisible, cancel]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold">Solve Divergence</h1>
                    <p className="mt-2 text-slate-800">
                        The vaults have diverged.
                    </p>
                    <p className="text-slate-800">
                        {/* Please select which changes to apply to this vault. */}
                        Please select the changes you would like to apply to
                        this vault.
                    </p>
                    <p className="text-slate-800">
                        After confirmation, the same changes will be applied to
                        the remote vault - bringing them back in sync.
                    </p>
                    {/* Show a count of the differences by type */}
                    <div className="mt-4 flex w-full flex-row justify-center">
                        <div className="flex flex-col items-center rounded-l-md border-y border-l bg-green-100 p-2">
                            <p className="text-slate-800">Additions</p>
                            <p className="text-sm font-bold text-slate-800">
                                {numberOfAdditions}
                            </p>
                        </div>
                        <div className="flex flex-col items-center border-y bg-yellow-100 p-2">
                            <p className="text-slate-800">Modifications</p>
                            <p className="text-sm font-bold text-slate-800">
                                {numberOfModifications}
                            </p>
                        </div>
                        <div className="flex flex-col items-center rounded-r-md border-y border-r bg-red-100 p-2">
                            <p className="text-slate-800">Removals</p>
                            <p className="text-sm font-bold text-slate-800">
                                {numberOfDeletions}
                            </p>
                        </div>
                    </div>
                    <div className="mt-4 w-full items-start">
                        {/* Select all checkbox with a count of currently selected items */}
                        <div className="flex flex-row items-start justify-between space-x-2 p-4 py-0">
                            <div
                                className="flex cursor-pointer space-x-2"
                                onClick={() =>
                                    selectAll(
                                        !(
                                            selectedDiffHashes.length ===
                                            differences.length
                                        )
                                    )
                                }
                            >
                                <input
                                    type="checkbox"
                                    checked={
                                        selectedDiffHashes.length ===
                                        differences.length
                                    }
                                    onChange={(e) =>
                                        selectAll(e.target.checked)
                                    }
                                />
                                <p className="text-slate-800">Select All</p>
                            </div>
                            <p className="text-slate-600">
                                {selectedDiffHashes.length} selected
                            </p>
                        </div>
                        <div className="flex max-h-56 flex-col space-y-2 overflow-auto rounded bg-slate-200 p-2">
                            {differences.map((difference, index) => (
                                <DiffItem
                                    key={index}
                                    difference={difference}
                                    checked={selectedDiffHashes.includes(
                                        difference.Hash
                                    )}
                                    onChangeFn={selectDiff}
                                />
                            ))}
                        </div>
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
    difference: Credential.Diff;
    checked: boolean;
    onChangeFn: (hash: string, checked: boolean) => void;
}> = ({ difference, checked, onChangeFn }) => {
    const diffType = difference.Changes?.Type ?? DiffType.Add;
    const name = difference.Changes?.Props?.Name ?? "Untitled";
    const username = difference.Changes?.Props?.Username ?? "";

    return (
        <div
            className={clsx({
                "flex cursor-pointer flex-row items-center space-x-2 space-y-1 rounded bg-slate-400/50 p-1 px-3 drop-shadow-sm transition-all hover:drop-shadow-md":
                    true,
                "shadow shadow-red-400": diffType === DiffType["Delete"],
                "shadow shadow-green-400": diffType === DiffType["Add"],
                "shadow shadow-yellow-400": diffType === DiffType["Update"],
            })}
            onClick={() => {
                // setChecked(!checked);
                onChangeFn(difference.Hash, !checked);
            }}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                    // No-op
                }}
            />
            <div className="flex flex-grow flex-col items-start text-start">
                <span
                    className="line-clamp-2 font-bold text-slate-800"
                    title={name}
                >
                    {name}
                </span>
                {username.length ? (
                    <span
                        className="line-clamp-1 text-sm text-slate-600"
                        title={username}
                    >
                        {username}
                    </span>
                ) : (
                    <span className="text-sm italic text-slate-600">
                        No username
                    </span>
                )}
            </div>
            <span className="text-sm text-slate-800">
                {
                    {
                        [DiffType["Delete"]]: "Remove from this vault",
                        [DiffType["Add"]]: "Add to this vault",
                        [DiffType["Update"]]: "Update this vault",
                    }[diffType]
                }
            </span>
        </div>
    );
};
