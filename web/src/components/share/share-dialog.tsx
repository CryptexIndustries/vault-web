import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, Lock } from "lucide-react";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { ShareClient } from "@cryptex-industries/vault-core/vault-utils/share-client";
import {
    SHARE_EXPIRY_OPTIONS,
    defaultShareExpiry,
    shareExpiryOptions,
    type ShareExpiryOption,
    type SharePayload,
} from "@cryptex-industries/vault-core/vault-utils/share-link";
import {
    buildCredentialSharePayload,
    buildTextSharePayload,
    defaultCredentialShareSelection,
    type CredentialShareSelection,
} from "@cryptex-industries/vault-core/vault-utils/share-payload";
import {
    createShareLink,
    resolveShareServer,
} from "@cryptex-industries/vault-core/vault-utils/share-service";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { copySecretToClipboard } from "@/utils/clipboard";
import { runSSHKeyTaskInWorker } from "@/utils/ssh-key";
import { describeShareError, type ShareBackend } from "./share-backend";
import { ShareServerSettingsForm } from "./share-server-settings";

export type ShareDialogTarget =
    | {
          kind: "credential";
          credential: Pick<
              VaultUtilTypes.Credential,
              | "ID"
              | "Name"
              | "Username"
              | "Password"
              | "URL"
              | "AdditionalURLs"
              | "Notes"
              | "TOTP"
              | "CustomFields"
              | "Passkey"
              | "SSHKey"
          >;
      }
    | { kind: "text" };

type ServerState =
    | { state: "checking" }
    | { state: "ready" }
    | { state: "needs-account" }
    | { state: "needs-token" }
    | { state: "unreachable" };

const DEFAULT_EXPIRY = SHARE_EXPIRY_OPTIONS[1].seconds;

export function ShareDialog({
    open,
    onOpenChange,
    target,
    backend,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    target: ShareDialogTarget | null;
    backend: ShareBackend;
}) {
    const [selection, setSelection] = useState<CredentialShareSelection>(
        defaultCredentialShareSelection,
    );
    const [text, setText] = useState("");
    const [label, setLabel] = useState("");
    const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
    const [usePassphrase, setUsePassphrase] = useState(false);
    const [passphrase, setPassphrase] = useState("");
    const [error, setError] = useState("");
    const [creating, setCreating] = useState(false);
    const [link, setLink] = useState("");
    // Describes the link that was created, not the form as it is now.
    const [linkInfo, setLinkInfo] = useState({
        passphrase: false,
        expiryLabel: "",
    });
    const [copied, setCopied] = useState(false);
    const [server, setServer] = useState<ServerState>({ state: "checking" });
    const [settings, setSettings] = useState<
        VaultUtilTypes.ShareSettings | undefined
    >();
    const [checkToken, setCheckToken] = useState(0);
    const [expiryOptions, setExpiryOptions] = useState<ShareExpiryOption[]>(
        () => SHARE_EXPIRY_OPTIONS.map((option) => ({ ...option })),
    );
    // Bumped whenever the dialog closes or switches item, so a request that
    // finishes later can't show its link for a different item.
    const sessionRef = useRef(0);

    useEffect(() => {
        sessionRef.current += 1;
        if (!open) return;
        setSelection(defaultCredentialShareSelection());
        setText("");
        setLabel(target?.kind === "credential" ? target.credential.Name : "");
        setExpiry(DEFAULT_EXPIRY);
        setUsePassphrase(false);
        setPassphrase("");
        setError("");
        setLink("");
        setCopied(false);
        setCreating(false);
    }, [open, target]);

    // Find out what the server needs before the user fills in the form.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setServer({ state: "checking" });
        void (async () => {
            let current: VaultUtilTypes.ShareSettings | undefined;
            try {
                current = await backend.deps.store.getShareSettings();
                const { origin, creationToken } = resolveShareServer(
                    current,
                    backend.deps.defaultOrigin,
                );
                const info = await new ShareClient(origin, {
                    fetch: backend.deps.fetch,
                }).info();
                if (cancelled) return;
                setSettings(current);
                const options = shareExpiryOptions(info.maxTtl);
                setExpiryOptions(options);
                setExpiry((value) =>
                    options.some((option) => option.seconds === value)
                        ? value
                        : defaultShareExpiry(options),
                );
                if (info.auth === "ticket") {
                    setServer({
                        state:
                            backend.deps.getTicket &&
                            backend.hasOnlineServicesSharing !== false
                                ? "ready"
                                : "needs-account",
                    });
                } else {
                    setServer({
                        state: creationToken ? "ready" : "needs-token",
                    });
                }
            } catch {
                if (!cancelled) {
                    setSettings(current);
                    setServer({ state: "unreachable" });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, backend, checkToken]);

    const payload = useMemo((): SharePayload | null => {
        try {
            if (target?.kind === "credential") {
                return buildCredentialSharePayload(
                    target.credential,
                    selection,
                );
            }
            return text.trim() ? buildTextSharePayload(text) : null;
        } catch {
            return null;
        }
    }, [selection, target, text]);

    const create = async () => {
        if (!payload) return;
        if (usePassphrase && !passphrase) {
            setError("Enter a passphrase or turn it off.");
            return;
        }
        setError("");
        setCreating(true);
        const session = sessionRef.current;
        const askedExpiry = expiryLabel;
        try {
            const created = await createShareLink(backend.deps, {
                payload: await withExportedSSHKey(payload),
                label: label.trim(),
                credentialId:
                    target?.kind === "credential" ? target.credential.ID : "",
                ttlSeconds: expiry,
                passphrase: usePassphrase ? passphrase : undefined,
            });
            if (session !== sessionRef.current) return;
            setLinkInfo({
                passphrase: created.record.Passphrase,
                expiryLabel: askedExpiry,
            });
            setLink(created.link);
            setText("");
        } catch (err) {
            if (session !== sessionRef.current) return;
            setError(describeShareError(err));
        } finally {
            if (session === sessionRef.current) setCreating(false);
        }
    };

    // Copy and reveal in the app give the OpenSSH file with the current
    // comment, so the link carries the same text.
    const withExportedSSHKey = async (
        built: SharePayload,
    ): Promise<SharePayload> => {
        if (target?.kind !== "credential") return built;
        const sshKey = target.credential.SSHKey;
        if (!sshKey || !selection.sshPrivateKey) return built;
        const result = await runSSHKeyTaskInWorker({
            kind: "export",
            data: sshKey,
        });
        if (!result.ok || result.kind !== "export") {
            throw new Error("SSH_KEY_EXPORT_FAILED");
        }
        return buildCredentialSharePayload(
            {
                ...target.credential,
                SSHKey: { ...sshKey, PrivateKey: result.text },
            },
            selection,
        );
    };

    const copyLink = async () => {
        if (await copySecretToClipboard(link, { showToast: false })) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        }
    };

    const expiryLabel =
        expiryOptions.find((option) => option.seconds === expiry)?.label ?? "";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        {target?.kind === "credential"
                            ? "Share once"
                            : "Share a secret"}
                    </DialogTitle>
                    <DialogDescription>
                        The link opens once, then it's gone. It is encrypted in
                        this browser and the key stays in the link, so the
                        server can't read it.
                    </DialogDescription>
                </DialogHeader>

                {link ? (
                    <ShareLinkResult
                        link={link}
                        copied={copied}
                        onCopy={copyLink}
                        expiryLabel={linkInfo.expiryLabel}
                        hasPassphrase={linkInfo.passphrase}
                    />
                ) : server.state === "checking" ? (
                    <div
                        className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
                        role="status"
                    >
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Checking the share server…
                    </div>
                ) : server.state === "needs-account" ? (
                    <NeedsAccount backend={backend} />
                ) : server.state === "needs-token" ||
                  server.state === "unreachable" ? (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            {server.state === "needs-token"
                                ? "This share server needs a creation token from its operator."
                                : "Can't reach the share server. Check the address, or try again later."}
                        </p>
                        <ShareServerSettingsForm
                            settings={settings}
                            allowCustomServer={backend.allowCustomServer}
                            defaultOrigin={backend.deps.defaultOrigin}
                            onSave={async (next) => {
                                await backend.saveSettings(next);
                                setCheckToken((value) => value + 1);
                            }}
                        />
                    </div>
                ) : (
                    // Nothing can change while the link is being created.
                    <fieldset
                        disabled={creating}
                        className="m-0 min-w-0 space-y-4 border-0 p-0"
                    >
                        {target?.kind === "credential" ? (
                            <CredentialFieldPicker
                                credential={target.credential}
                                selection={selection}
                                onChange={setSelection}
                            />
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="share-text">Secret</Label>
                                    <Textarea
                                        id="share-text"
                                        value={text}
                                        rows={5}
                                        autoFocus
                                        spellCheck={false}
                                        autoComplete="off"
                                        placeholder="Paste a password, API key or note"
                                        onChange={(event) =>
                                            setText(event.target.value)
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="share-label">
                                        Label for your list
                                    </Label>
                                    <Input
                                        id="share-label"
                                        value={label}
                                        maxLength={100}
                                        placeholder="Wi-Fi for Sam"
                                        onChange={(event) =>
                                            setLabel(event.target.value)
                                        }
                                    />
                                </div>
                            </>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="share-expiry">
                                Expires if not opened within
                            </Label>
                            <Select
                                value={String(expiry)}
                                onValueChange={(value) =>
                                    setExpiry(Number(value))
                                }
                            >
                                <SelectTrigger id="share-expiry">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {expiryOptions.map((option) => (
                                        <SelectItem
                                            key={option.seconds}
                                            value={String(option.seconds)}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label
                                    htmlFor="share-passphrase-toggle"
                                    className="flex items-center gap-2"
                                >
                                    <Lock className="h-3.5 w-3.5" />
                                    Require a passphrase
                                </Label>
                                <Switch
                                    id="share-passphrase-toggle"
                                    checked={usePassphrase}
                                    onCheckedChange={setUsePassphrase}
                                />
                            </div>
                            {usePassphrase ? (
                                <>
                                    <PasswordInput
                                        value={passphrase}
                                        autoComplete="new-password"
                                        secretLabel="passphrase"
                                        placeholder="Passphrase"
                                        onChange={(event) =>
                                            setPassphrase(event.target.value)
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Send the passphrase another way, for
                                        example by phone. Five wrong tries
                                        destroy the link.
                                    </p>
                                </>
                            ) : null}
                        </div>

                        {error ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {error}
                            </p>
                        ) : null}
                    </fieldset>
                )}

                <DialogFooter>
                    {link ? (
                        <Button onClick={() => onOpenChange(false)}>
                            Done
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                disabled={creating}
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            {server.state === "ready" ? (
                                <Button
                                    disabled={creating || !payload}
                                    onClick={() => void create()}
                                >
                                    {creating ? "Creating…" : "Create link"}
                                </Button>
                            ) : null}
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function NeedsAccount({ backend }: { backend: ShareBackend }) {
    const signedIn = !!backend.deps.getTicket;
    return (
        <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
                {signedIn
                    ? "Share links on the Cryptex Vault server are part of Online Services."
                    : "Sign in to Online Services to create share links on the Cryptex Vault server."}
            </p>
            <p className="text-muted-foreground">
                You can also run your own share server. The{" "}
                <a
                    className="underline underline-offset-2"
                    href="/docs/self-hosting"
                    target="_blank"
                    rel="noreferrer"
                >
                    self-hosting guide
                </a>{" "}
                explains how.
            </p>
            {backend.onOpenAccount ? (
                <Button onClick={backend.onOpenAccount}>
                    {signedIn ? "See Online Services" : "Sign in"}
                </Button>
            ) : null}
        </div>
    );
}

function ShareLinkResult({
    link,
    copied,
    onCopy,
    expiryLabel,
    hasPassphrase,
}: {
    link: string;
    copied: boolean;
    onCopy: () => void;
    expiryLabel: string;
    hasPassphrase: boolean;
}) {
    return (
        <div className="space-y-3">
            <Label htmlFor="share-link">Link</Label>
            <div className="flex gap-2">
                <Input
                    id="share-link"
                    readOnly
                    value={link}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                    variant="outline"
                    size="icon"
                    onClick={onCopy}
                    aria-label="Copy link"
                >
                    {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                    ) : (
                        <Copy className="h-4 w-4" />
                    )}
                </Button>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Copy it now. Cryptex Vault can't show this link again.</li>
                <li>It works once and expires in {expiryLabel} if unopened.</li>
                {hasPassphrase ? (
                    <li>Send the passphrase separately from the link.</li>
                ) : null}
                <li>You can revoke it under Shared links.</li>
            </ul>
        </div>
    );
}

function CredentialFieldPicker({
    credential,
    selection,
    onChange,
}: {
    credential: Extract<
        ShareDialogTarget,
        { kind: "credential" }
    >["credential"];
    selection: CredentialShareSelection;
    onChange: (selection: CredentialShareSelection) => void;
}) {
    const toggle = (
        key: Exclude<keyof CredentialShareSelection, "customFieldIds">,
    ) => onChange({ ...selection, [key]: !selection[key] });
    const toggleCustom = (id: string) =>
        onChange({
            ...selection,
            customFieldIds: selection.customFieldIds.includes(id)
                ? selection.customFieldIds.filter((entry) => entry !== id)
                : [...selection.customFieldIds, id],
        });

    const rows: {
        id: string;
        label: string;
        checked: boolean;
        onToggle: () => void;
    }[] = [
        {
            id: "name",
            label: `Name (${credential.Name || "untitled"})`,
            checked: selection.name,
            onToggle: () => toggle("name"),
        },
    ];
    if (credential.SSHKey) {
        rows.push(
            {
                id: "ssh-private-key",
                label: "Private key",
                checked: selection.sshPrivateKey,
                onToggle: () => toggle("sshPrivateKey"),
            },
            {
                id: "ssh-public-key",
                label: "Public key",
                checked: selection.sshPublicKey,
                onToggle: () => toggle("sshPublicKey"),
            },
        );
    }
    if (credential.Username) {
        rows.push({
            id: "username",
            label: "Username",
            checked: selection.username,
            onToggle: () => toggle("username"),
        });
    }
    if (credential.Password) {
        rows.push({
            id: "password",
            label: "Password",
            checked: selection.password,
            onToggle: () => toggle("password"),
        });
    }
    if (credential.URL || credential.AdditionalURLs.length > 0) {
        rows.push({
            id: "url",
            label: "Website",
            checked: selection.url,
            onToggle: () => toggle("url"),
        });
    }
    if (credential.TOTP?.Secret) {
        rows.push({
            id: "totp",
            label: "One-time code setup (TOTP secret)",
            checked: selection.totp,
            onToggle: () => toggle("totp"),
        });
    }
    for (const field of credential.CustomFields) {
        rows.push({
            id: `custom-${field.ID}`,
            label: field.Name || "Custom field",
            checked: selection.customFieldIds.includes(field.ID),
            onToggle: () => toggleCustom(field.ID),
        });
    }
    if (credential.Notes) {
        rows.push({
            id: "notes",
            label: "Notes",
            checked: selection.notes,
            onToggle: () => toggle("notes"),
        });
    }

    return (
        <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Include</legend>
            {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                    <Checkbox
                        id={`share-field-${row.id}`}
                        checked={row.checked}
                        onCheckedChange={row.onToggle}
                    />
                    <Label
                        htmlFor={`share-field-${row.id}`}
                        className="font-normal"
                    >
                        {row.label}
                    </Label>
                </div>
            ))}
            {credential.SSHKey && selection.sshPrivateKey ? (
                <p className="pt-1 text-xs text-muted-foreground">
                    Anyone who opens the link can use this key on every server
                    that accepts it.
                </p>
            ) : null}
            {credential.Passkey ? (
                <p className="pt-1 text-xs text-muted-foreground">
                    The passkey stays in your vault. Passkeys are never shared.
                </p>
            ) : null}
        </fieldset>
    );
}
