import { useCallback, useEffect, useRef, useState } from "react";
import { FileKey, FileUp, KeyRound, Loader2, Lock, X } from "lucide-react";
import type { SSHKeyData } from "@cryptex-industries/vault-core/proto";
import {
    parseSSHPublicKey,
    SSH_PUBLIC_KEY_INVALID_MESSAGE,
    sshPublicKeyLine,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    getSSHKeyInfo,
    loadSSHKeyModule,
    runSSHKeyTaskInWorker,
} from "@/utils/ssh-key";

export type SSHKeySource = "generate" | "import";

/** Key files are a few kilobytes; anything far larger is the wrong file. */
const MAX_KEY_FILE_BYTES = 64 * 1024;
/** Typing and pasting wait this long before the key is checked. */
const TYPING_CHECK_DELAY_MS = 500;
type ImportStatus =
    | "idle"
    | "checking"
    | "needs-passphrase"
    | "unlocking"
    | "ready"
    | "error";

type ImportState = {
    text: string;
    publicKey: string;
    publicKeyFileName: string;
    /** Why the last file picked as the .pub was not used. */
    publicKeyError: string;
    passphrase: string;
    status: ImportStatus;
    error: string;
    passphraseError: string;
    key: SSHKeyData | null;
};

const initialImportState: ImportState = {
    text: "",
    publicKey: "",
    publicKeyFileName: "",
    publicKeyError: "",
    passphrase: "",
    status: "idle",
    error: "",
    passphraseError: "",
    key: null,
};

/** What a key check reads: the private key text and the optional .pub. */
type CheckInput = { text: string; publicKey: string };

type CheckRequest = CheckInput & {
    /** Set by Unlock. Without it a passphrase that worked for the text is reused. */
    passphrase?: string;
    /** Waits this long before starting, for typing. */
    delayMs?: number;
};

/** A check waiting for its delay or running in the worker. */
type Check = CheckInput & {
    passphrase: string | undefined;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout> | null;
};

type KeyPassphrase = { text: string; passphrase: string };

const sameInput = (a: CheckInput | null, b: CheckInput) =>
    a !== null && a.text === b.text && a.publicKey === b.publicKey;

/** Reads a picked key file, or says why it can't be used. */
async function readKeyFile(
    file: File,
): Promise<{ text: string } | { error: string }> {
    if (file.size > MAX_KEY_FILE_BYTES) {
        return { error: "That file is too large to be an SSH key." };
    }
    try {
        return { text: await file.text() };
    } catch {
        return { error: "The file could not be read." };
    }
}

/**
 * State for the SSH key editor in create mode: a generated Ed25519 key that
 * survives switching modes, and an imported key with its passphrase prompt.
 *
 * Imports are driven by user actions: each one calls `requestCheck`, which
 * sets the busy state and starts (or schedules) the worker run in the same
 * step, so the editor is never busy without a run behind it. A newer request
 * cancels the one before it.
 */
export function useNewSSHKey(
    name: string,
    active: boolean,
    initialSource: SSHKeySource = "generate",
) {
    const [source, setSourceState] = useState<SSHKeySource>(initialSource);
    const [generated, setGenerated] = useState<SSHKeyData | null>(null);
    const [generatedCommentEdited, setGeneratedCommentEdited] = useState(false);
    const [generateError, setGenerateError] = useState("");
    const [imported, setImportedState] =
        useState<ImportState>(initialImportState);
    // Mirrors `imported` so actions and finished runs read the latest input.
    const importedRef = useRef(imported);
    const checkRef = useRef<Check | null>(null);
    // The input behind the shown ready or needs-passphrase result.
    const settledRef = useRef<
        (CheckInput & { status: "ready" | "needs-passphrase" }) | null
    >(null);
    // The passphrase that unlocked this key text, so a .pub change can
    // re-check the key without locking it again. Never stored in state.
    const unlockedWithRef = useRef<KeyPassphrase | null>(null);
    // The unlock in progress, so a .pub change during it keeps the passphrase.
    const unlockingWithRef = useRef<KeyPassphrase | null>(null);
    const nameRef = useRef(name);
    nameRef.current = name;

    const updateImported = useCallback(
        (change: (state: ImportState) => ImportState) => {
            const next = change(importedRef.current);
            importedRef.current = next;
            setImportedState(next);
        },
        [],
    );

    const cancelCheck = useCallback(() => {
        const check = checkRef.current;
        checkRef.current = null;
        if (!check) return;
        if (check.timer) clearTimeout(check.timer);
        check.controller.abort();
    }, []);

    const runCheck = useCallback(
        async (check: Check) => {
            const { text, publicKey, passphrase } = check;
            const result = await runSSHKeyTaskInWorker(
                {
                    kind: "import",
                    text,
                    passphrase,
                    publicKey: publicKey || undefined,
                },
                { signal: check.controller.signal },
            );
            if (checkRef.current !== check) return;
            checkRef.current = null;
            unlockingWithRef.current = null;

            if (result.ok) {
                if (result.kind !== "import") return;
                unlockedWithRef.current =
                    passphrase === undefined ? null : { text, passphrase };
                settledRef.current = { text, publicKey, status: "ready" };
                updateImported((state) => ({
                    ...state,
                    status: "ready",
                    passphrase: "",
                    error: "",
                    passphraseError: "",
                    key: result.data,
                }));
                return;
            }

            if (result.code === "wrong-passphrase") {
                unlockedWithRef.current = null;
            }
            // A failed unlock stays at the passphrase prompt so the user can
            // try again.
            const failedUnlock =
                result.code === "wrong-passphrase" ||
                (passphrase !== undefined && result.code === "internal");
            if (result.code === "passphrase-required" || failedUnlock) {
                settledRef.current = {
                    text,
                    publicKey,
                    status: "needs-passphrase",
                };
                updateImported((state) => ({
                    ...state,
                    status: "needs-passphrase",
                    error: "",
                    passphraseError: failedUnlock ? result.message : "",
                    key: null,
                }));
                return;
            }
            settledRef.current = null;
            updateImported((state) => ({
                ...state,
                status: "error",
                error: result.message,
                passphraseError: "",
                key: null,
            }));
        },
        [updateImported],
    );

    /**
     * Checks the key for `text` and `publicKey`, cancelling any earlier
     * check. Asking again for what is already shown or running changes
     * nothing, so an unlocked key stays unlocked.
     */
    const requestCheck = useCallback(
        ({ text, publicKey, passphrase, delayMs = 0 }: CheckRequest) => {
            const input = { text, publicKey };
            const keyPassphrase =
                passphrase ??
                [unlockedWithRef.current, unlockingWithRef.current].find(
                    (entry) => entry?.text === text,
                )?.passphrase;

            if (passphrase === undefined) {
                const running = checkRef.current;
                if (
                    sameInput(running, input) &&
                    running?.passphrase === keyPassphrase
                ) {
                    return;
                }
                const settled = settledRef.current;
                // A locked key asks for its passphrase whatever the .pub
                // is; the .pub is checked when it is unlocked.
                const stillLocked =
                    settled?.status === "needs-passphrase" &&
                    settled.text === text &&
                    keyPassphrase === undefined;
                if (
                    settled &&
                    (stillLocked ||
                        (sameInput(settled, input) &&
                            settled.status === "ready"))
                ) {
                    cancelCheck();
                    settledRef.current = { ...settled, publicKey };
                    updateImported((state) => ({
                        ...state,
                        status: settled.status,
                    }));
                    return;
                }
            }

            cancelCheck();
            if (!text.trim()) {
                settledRef.current = null;
                unlockingWithRef.current = null;
                updateImported((state) => ({
                    ...state,
                    status: "idle",
                    error: "",
                    passphraseError: "",
                    key: null,
                }));
                return;
            }

            if (passphrase !== undefined) {
                unlockingWithRef.current = { text, passphrase };
            }
            const check: Check = {
                ...input,
                passphrase: keyPassphrase,
                controller: new AbortController(),
                timer: null,
            };
            checkRef.current = check;
            updateImported((state) => ({
                ...state,
                status: keyPassphrase === undefined ? "checking" : "unlocking",
            }));
            const start = () => {
                check.timer = null;
                void runCheck(check);
            };
            if (delayMs > 0) {
                check.timer = setTimeout(start, delayMs);
            } else {
                start();
            }
        },
        [cancelCheck, runCheck, updateImported],
    );

    const reset = useCallback(() => {
        cancelCheck();
        settledRef.current = null;
        unlockedWithRef.current = null;
        unlockingWithRef.current = null;
        setSourceState("generate");
        setGenerated(null);
        setGeneratedCommentEdited(false);
        setGenerateError("");
        updateImported(() => initialImportState);
    }, [cancelCheck, updateImported]);

    // A closed form drops whatever check is still running.
    useEffect(() => {
        if (!active) return;
        return () => {
            if (!checkRef.current) return;
            cancelCheck();
            settledRef.current = null;
            unlockingWithRef.current = null;
            updateImported((state) => ({
                ...state,
                status: "idle",
                key: null,
            }));
        };
    }, [active, cancelCheck, updateImported]);

    useEffect(() => {
        if (!active || source !== "generate" || generated) return;
        let cancelled = false;
        loadSSHKeyModule()
            .then(({ generateSSHKey }) => {
                if (!cancelled) setGenerated(generateSSHKey(nameRef.current));
            })
            .catch(() => {
                if (!cancelled) {
                    setGenerateError("The key could not be generated.");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [active, generated, source]);

    // A generated key's comment follows the item name until it is edited.
    useEffect(() => {
        if (!generated || generatedCommentEdited) return;
        const comment = name.trim();
        if (generated.Comment !== comment) {
            setGenerated({ ...generated, Comment: comment });
        }
    }, [generated, generatedCommentEdited, name]);

    const setSource = (next: SSHKeySource) => {
        setSourceState(next);
        if (next === "import") {
            const { text, publicKey } = importedRef.current;
            requestCheck({ text, publicKey });
        }
    };

    const setPrivateKeyText = (text: string) => {
        const state = importedRef.current;
        if (state.text === text) return;
        updateImported((current) => ({ ...current, text }));
        requestCheck({
            text,
            publicKey: state.publicKey,
            delayMs: TYPING_CHECK_DELAY_MS,
        });
    };

    const setPassphrase = (passphrase: string) =>
        updateImported((state) => ({
            ...state,
            passphrase,
            passphraseError: "",
        }));

    const unlock = () => {
        const { text, publicKey, passphrase, status } = importedRef.current;
        if (!passphrase || status === "unlocking") return;
        requestCheck({ text, publicKey, passphrase });
    };

    /** Uses a picked file as the private key. A .pub file here gets explained. */
    const choosePrivateKeyFile = async (file: File) => {
        const read = await readKeyFile(file);
        if ("error" in read) {
            cancelCheck();
            settledRef.current = null;
            updateImported((state) => ({
                ...state,
                status: "error",
                error: read.error,
                key: null,
            }));
            return;
        }
        const { text } = read;
        updateImported((state) =>
            state.text === text
                ? state
                : { ...state, text, passphrase: "", passphraseError: "" },
        );
        requestCheck({ text, publicKey: importedRef.current.publicKey });
    };

    /**
     * Adds a picked .pub file. A file that isn't a public key is refused
     * and leaves the private key as it is.
     */
    const choosePublicKeyFile = async (file: File) => {
        const read = await readKeyFile(file);
        const error =
            "error" in read
                ? read.error
                : parseSSHPublicKey(read.text)
                  ? ""
                  : SSH_PUBLIC_KEY_INVALID_MESSAGE;
        if ("error" in read || error) {
            updateImported((state) => ({ ...state, publicKeyError: error }));
            return;
        }
        updateImported((state) => ({
            ...state,
            publicKey: read.text,
            publicKeyFileName: file.name,
            publicKeyError: "",
        }));
        requestCheck({
            text: importedRef.current.text,
            publicKey: read.text,
        });
    };

    const removePublicKey = () => {
        updateImported((state) => ({
            ...state,
            publicKey: "",
            publicKeyFileName: "",
            publicKeyError: "",
        }));
        requestCheck({ text: importedRef.current.text, publicKey: "" });
    };

    const isImportBusy =
        imported.status === "checking" || imported.status === "unlocking";
    const current =
        source === "generate"
            ? generated
            : imported.status === "ready"
              ? imported.key
              : null;

    const setComment = (comment: string) => {
        if (source === "generate") {
            setGeneratedCommentEdited(true);
            setGenerated((key) => (key ? { ...key, Comment: comment } : key));
            return;
        }
        updateImported((state) =>
            state.key
                ? { ...state, key: { ...state.key, Comment: comment } }
                : state,
        );
    };

    return {
        source,
        setSource,
        generated,
        generateError,
        imported,
        current,
        /** A key is being checked or unlocked; saving must wait. */
        busy: source === "import" && isImportBusy,
        isDirty:
            generatedCommentEdited ||
            imported.text.trim() !== "" ||
            imported.publicKey !== "",
        reset,
        setComment,
        setPrivateKeyText,
        setPassphrase,
        unlock,
        removePublicKey,
        choosePrivateKeyFile,
        choosePublicKeyFile,
    };
}

export type NewSSHKeyDraft = ReturnType<typeof useNewSSHKey>;

/** Type, fingerprint and public key line of a key, read-only. */
export function SSHKeySummary({ sshKey }: { sshKey: SSHKeyData }) {
    const info = getSSHKeyInfo(sshKey);
    return (
        <div className="min-w-0 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex min-w-0 items-center gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-medium">
                    {info?.label ?? "Unknown key type"}
                </span>
            </div>
            {info && (
                <p
                    className="break-all font-mono text-xs text-muted-foreground"
                    data-testid="ssh-key-fingerprint"
                >
                    {info.fingerprint}
                </p>
            )}
            <p className="line-clamp-3 break-all font-mono text-xs text-foreground/80">
                {sshPublicKeyLine(sshKey)}
            </p>
        </div>
    );
}

function SourceOption({
    value,
    checked,
    title,
    description,
    onSelect,
}: {
    value: SSHKeySource;
    checked: boolean;
    title: string;
    description: string;
    onSelect: (value: SSHKeySource) => void;
}) {
    return (
        <label
            className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                checked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
            )}
        >
            <input
                type="radio"
                name="ssh-key-source"
                value={value}
                checked={checked}
                onChange={() => onSelect(value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="min-w-0">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                    {description}
                </span>
            </span>
        </label>
    );
}

/** The top of the SSH key editor in create mode: generate or import. */
export function NewSSHKeyFields({
    draft,
    error,
    onChooseFile,
    fileHint,
}: {
    draft: NewSSHKeyDraft;
    error?: string;
    /**
     * Replaces both file pickers, e.g. to move to a tab that can keep a
     * picker open.
     */
    onChooseFile?: () => void;
    /** A line shown above the key field until a key is entered. */
    fileHint?: string;
}) {
    const keyFileInputRef = useRef<HTMLInputElement>(null);
    const publicKeyFileInputRef = useRef<HTMLInputElement>(null);
    const { imported } = draft;
    const isUnlocking = imported.status === "unlocking";
    // Typed passphrases show their prompt while unlocking; a key re-checked
    // with the passphrase that already worked only shows a status line.
    const showPassphrase =
        imported.status === "needs-passphrase" ||
        (isUnlocking && imported.passphrase !== "");

    return (
        <div className="space-y-3">
            <div
                role="radiogroup"
                aria-label="Key source"
                className="grid gap-2"
            >
                <SourceOption
                    value="generate"
                    checked={draft.source === "generate"}
                    title="Generate a new key"
                    description="Creates an Ed25519 key in your vault."
                    onSelect={draft.setSource}
                />
                <SourceOption
                    value="import"
                    checked={draft.source === "import"}
                    title="Use an existing key"
                    description="Paste a private key or choose the key file."
                    onSelect={draft.setSource}
                />
            </div>

            {draft.source === "generate" ? (
                draft.generated ? (
                    <SSHKeySummary sshKey={draft.generated} />
                ) : draft.generateError ? (
                    <p className="text-xs text-destructive" role="alert">
                        {draft.generateError}
                    </p>
                ) : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generating key...
                    </p>
                )
            ) : (
                <div className="space-y-3">
                    <div className="space-y-2">
                        <Label
                            htmlFor="ssh-private-key"
                            className="text-sm font-medium"
                        >
                            Private key
                        </Label>
                        {fileHint && !imported.text && (
                            <p
                                className="text-xs font-medium text-foreground"
                                data-testid="ssh-key-file-hint"
                            >
                                {fileHint}
                            </p>
                        )}
                        <Textarea
                            id="ssh-private-key"
                            value={imported.text}
                            onChange={(event) =>
                                draft.setPrivateKeyText(event.target.value)
                            }
                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                            spellCheck={false}
                            autoComplete="off"
                            rows={6}
                            className={cn(
                                "resize-y font-mono text-xs",
                                imported.status === "error" &&
                                    "border-destructive",
                            )}
                        />
                        {(imported.status === "checking" ||
                            (isUnlocking && !showPassphrase)) && (
                            <p
                                className="flex items-center gap-2 text-xs text-muted-foreground"
                                role="status"
                            >
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {isUnlocking
                                    ? "Unlocking..."
                                    : "Checking key..."}
                            </p>
                        )}
                        {imported.status === "error" && imported.error && (
                            <p
                                className="text-xs text-destructive"
                                role="alert"
                            >
                                {imported.error}
                            </p>
                        )}
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="flex-1 gap-1.5"
                                onClick={() =>
                                    onChooseFile
                                        ? onChooseFile()
                                        : keyFileInputRef.current?.click()
                                }
                            >
                                <FileKey className="h-3.5 w-3.5" />
                                Choose file
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="flex-1 gap-1.5"
                                // Changing it would restart the unlock.
                                disabled={isUnlocking}
                                onClick={() =>
                                    onChooseFile
                                        ? onChooseFile()
                                        : publicKeyFileInputRef.current?.click()
                                }
                            >
                                <FileUp className="h-3.5 w-3.5" />
                                Add .pub file
                            </Button>
                            <input
                                ref={keyFileInputRef}
                                type="file"
                                className="hidden"
                                aria-label="Choose key file"
                                data-testid="ssh-key-file-input"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) {
                                        void draft.choosePrivateKeyFile(file);
                                    }
                                }}
                            />
                            <input
                                ref={publicKeyFileInputRef}
                                type="file"
                                className="hidden"
                                aria-label="Add .pub file"
                                data-testid="ssh-pub-file-input"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) {
                                        void draft.choosePublicKeyFile(file);
                                    }
                                }}
                            />
                        </div>
                        {imported.publicKeyFileName && (
                            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs">
                                <span className="min-w-0 flex-1 truncate">
                                    Public key file:{" "}
                                    {imported.publicKeyFileName}
                                </span>
                                <button
                                    type="button"
                                    onClick={draft.removePublicKey}
                                    disabled={isUnlocking}
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                                    aria-label="Remove public key file"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                        {imported.publicKeyError && (
                            <p
                                className="text-xs text-destructive"
                                role="alert"
                            >
                                {imported.publicKeyError}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            The .pub file is optional. It adds the comment and
                            is checked against the key.
                        </p>
                    </div>

                    {showPassphrase && (
                        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-start gap-2">
                                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <p className="text-xs text-muted-foreground">
                                    This key is protected with a passphrase. The
                                    passphrase is only used to unlock it and is
                                    not saved.
                                </p>
                            </div>
                            <Label
                                htmlFor="ssh-import-passphrase"
                                className="text-sm font-medium"
                            >
                                Passphrase
                            </Label>
                            <div className="flex items-center gap-2">
                                <PasswordInput
                                    id="ssh-import-passphrase"
                                    secretLabel="passphrase"
                                    value={imported.passphrase}
                                    autoComplete="off"
                                    disabled={isUnlocking}
                                    onChange={(event) =>
                                        draft.setPassphrase(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            draft.unlock();
                                        }
                                    }}
                                    className={cn(
                                        imported.passphraseError &&
                                            "text-destructive",
                                    )}
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-9 shrink-0"
                                    disabled={
                                        isUnlocking || !imported.passphrase
                                    }
                                    onClick={draft.unlock}
                                >
                                    {isUnlocking ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Unlocking...
                                        </>
                                    ) : (
                                        "Unlock"
                                    )}
                                </Button>
                            </div>
                            {imported.passphraseError && (
                                <p
                                    className="text-xs text-destructive"
                                    role="alert"
                                >
                                    {imported.passphraseError}
                                </p>
                            )}
                        </div>
                    )}

                    {imported.status === "ready" && imported.key && (
                        <SSHKeySummary sshKey={imported.key} />
                    )}
                </div>
            )}

            {error && !draft.current && (
                <p className="text-xs text-destructive" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
