/**
 * SSH key part of the popup credential form. Generating and importing reuse
 * the web dashboard's editor pieces; this wrapper syncs the key into the
 * react-hook-form value and adds the comment field.
 */

import { useEffect, useRef, useState } from "react";
import type { SSHKeyData } from "@cryptex-industries/vault-core/proto";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    NewSSHKeyFields,
    SSHKeySummary,
    useNewSSHKey,
    type SSHKeySource,
} from "@/components/vault-dashboard/ssh-key-editor";

export type SSHKeyEditorProps = {
    mode: "create" | "edit";
    value: SSHKeyData | null;
    onChange: (value: SSHKeyData | null, options: { dirty: boolean }) => void;
    /** The item name; a generated key's comment follows it until edited. */
    itemName: string;
    error?: string;
    /** The Name field, rendered between the key and the comment. */
    nameField: React.ReactNode;
    /** Reports while a key is being checked or unlocked. */
    onBusyChange?: (busy: boolean) => void;
    /** Which option a new key starts on. */
    initialSource?: SSHKeySource;
    /** Replaces both file pickers (the popup hands off to a full tab). */
    onChooseFile?: () => void;
    /** A line shown above the key field until a key is entered. */
    fileHint?: string;
};

export function SSHKeyEditor({
    mode,
    value,
    onChange,
    itemName,
    error,
    nameField,
    onBusyChange,
    initialSource,
    onChooseFile,
    fileHint,
}: SSHKeyEditorProps) {
    // A create form restored from a draft already holds its key; keep that
    // key fixed like in edit mode rather than generating a new one.
    const [keyIsFixed] = useState(mode === "edit" || value !== null);
    const draft = useNewSSHKey(itemName, !keyIsFixed, initialSource);
    const draftKey = draft.current;
    const draftIsDirty = draft.isDirty;

    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (keyIsFixed) return;
        onChangeRef.current(draftKey, { dirty: draftIsDirty });
    }, [keyIsFixed, draftKey, draftIsDirty]);

    // Report busy changes, and clear them when the form closes so the next
    // form doesn't start with Save disabled.
    useEffect(() => {
        onBusyChange?.(draft.busy);
    }, [draft.busy, onBusyChange]);
    useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

    const current = keyIsFixed ? value : draftKey;

    const updateComment = (comment: string) => {
        if (!keyIsFixed) {
            draft.setComment(comment);
        } else if (value) {
            onChange({ ...value, Comment: comment }, { dirty: true });
        }
    };

    return (
        <div className="space-y-4">
            {keyIsFixed ? (
                value ? (
                    <div className="space-y-2">
                        <SSHKeySummary sshKey={value} />
                        <p className="text-xs text-muted-foreground">
                            The key itself can&apos;t be changed. To use a
                            different key, add a new SSH key item.
                        </p>
                    </div>
                ) : null
            ) : (
                <NewSSHKeyFields
                    draft={draft}
                    error={error}
                    onChooseFile={onChooseFile}
                    fileHint={fileHint}
                />
            )}

            {nameField}

            <div className="space-y-1.5">
                <Label htmlFor="ssh-comment" className="text-xs font-medium">
                    Comment
                </Label>
                <Input
                    id="ssh-comment"
                    placeholder="e.g., you@laptop"
                    value={current?.Comment ?? ""}
                    onChange={(event) => updateComment(event.target.value)}
                    disabled={!current}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-9 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                    Shown at the end of the public key.
                </p>
            </div>
        </div>
    );
}
