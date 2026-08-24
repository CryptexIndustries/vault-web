/**
 * Save-credential prompt rendered inside the popup when the content
 * script flags a successful login on a page whose credentials are not
 * yet stored in the vault.
 *
 * Pre-fills `Name`, `URL`, `Username`, and `Password` from the pending
 * prompt and lets the user save in one click or dismiss without
 * persisting. Both paths clear the SW-side prompt so the popup is not
 * stuck in this state on the next open.
 */

import { useEffect, useMemo, useState } from "react";
import {
    Check,
    Fingerprint,
    Globe,
    Loader2,
    Save,
    Search,
    ShieldCheck,
    X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

import {
    MessageType,
    type LiteCredential,
    type PendingSavePrompt,
} from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "../utils/sw-envelope-client";
import { uiLog, vaultLog } from "../utils/ext-logging";
import {
    CredentialURLMatchMode,
    CustomFieldType,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import { credentialMatchesPageUrl } from "@cryptex-industries/vault-core/credential-url";

export type PopupSaveCredentialProps = {
    prompt: PendingSavePrompt;
    onDone: (outcome: "saved" | "dismissed") => void;
    /** In-page iframe: size to content instead of filling a fixed parent. */
    embedded?: boolean;
};

const PopupSaveCredential: React.FC<PopupSaveCredentialProps> = ({
    prompt,
    onDone,
    embedded = false,
}) => {
    const [name, setName] = useState<string>("");
    const [username, setUsername] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const [url, setUrl] = useState<string>("");
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attachmentCandidates, setAttachmentCandidates] = useState<
        LiteCredential[]
    >([]);
    const [saveMode, setSaveMode] = useState<"new" | "existing">("new");
    const [selectedCredentialId, setSelectedCredentialId] = useState<
        string | null
    >(null);
    const [credentialQuery, setCredentialQuery] = useState("");
    const [credentialPickerOpen, setCredentialPickerOpen] = useState(false);
    const isPasskey = prompt.kind === "passkey";

    useEffect(() => {
        setName(prompt.passkey?.RPName ?? prompt.host);
        setUsername(prompt.passkey?.UserName ?? prompt.username);
        setPassword(prompt.password);
        setUrl(prompt.url);
        setShowPassword(false);
        setSaveMode("new");
        setSelectedCredentialId(null);
        setCredentialQuery("");
        setCredentialPickerOpen(false);
    }, [prompt]);

    useEffect(() => {
        if (!isPasskey) {
            setAttachmentCandidates([]);
            return;
        }

        let cancelled = false;
        setAttachmentCandidates([]);
        void sendEncryptedEnvelopeToSW<{
            ok: boolean;
            credentials: LiteCredential[];
        }>(MessageType.GetCredentials, null).then((res) => {
            if (cancelled || !res.ok || !res.payload?.ok) return;
            setAttachmentCandidates(
                res.payload.credentials
                    .filter(
                        (credential) =>
                            credential.type === ItemType.Credentials &&
                            !credential.passkey,
                    )
                    .sort((a, b) => {
                        const matchesCurrentPage = (
                            credential: LiteCredential,
                        ) =>
                            credentialMatchesPageUrl(
                                {
                                    URL: credential.url,
                                    URLMatchMode: credential.urlMatchMode,
                                    AdditionalURLs: credential.additionalUrls,
                                },
                                prompt.url,
                            );
                        const matchOrder =
                            Number(matchesCurrentPage(b)) -
                            Number(matchesCurrentPage(a));
                        return matchOrder || a.name.localeCompare(b.name);
                    }),
            );
        });

        return () => {
            cancelled = true;
        };
    }, [isPasskey, prompt]);

    const selectedCredential = useMemo(
        () =>
            attachmentCandidates.find(
                (credential) => credential.id === selectedCredentialId,
            ) ?? null,
        [attachmentCandidates, selectedCredentialId],
    );

    const filteredCandidates = useMemo(() => {
        const query = credentialQuery.trim().toLocaleLowerCase();
        return query
            ? attachmentCandidates.filter((credential) =>
                  [
                      credential.name,
                      credential.username,
                      credential.url,
                      ...credential.additionalUrls.map((rule) => rule.URL),
                  ].some((value) => value.toLocaleLowerCase().includes(query)),
              )
            : attachmentCandidates;
    }, [attachmentCandidates, credentialQuery]);

    const visibleCandidates = filteredCandidates.slice(0, 6);

    const submitDisabled = useMemo(
        () =>
            saving ||
            (saveMode === "existing" && !selectedCredential) ||
            (saveMode === "new" && (!name.trim() || (!isPasskey && !password))),
        [saving, saveMode, selectedCredential, name, password, isPasskey],
    );

    const consumeAndExit = async (outcome: "saved" | "dismissed") => {
        try {
            await sendEncryptedEnvelopeToSW(
                MessageType.ConsumePendingSavePrompt,
                null,
            );
        } catch (err) {
            uiLog.warn("Failed to consume pending save prompt", { err });
        }
        onDone(outcome);
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        if (isPasskey && saveMode === "existing" && selectedCredential) {
            if (!prompt.passkey) {
                setError("PASSKEY_DATA_REQUIRED");
                setSaving(false);
                return;
            }

            const attachRes = await sendEncryptedEnvelopeToSW<{
                ok: boolean;
                error?: string;
            }>(MessageType.AttachPasskey, {
                credentialId: selectedCredential.id,
                passkey: prompt.passkey,
            });
            if (!attachRes.ok || !attachRes.payload?.ok) {
                setError(
                    !attachRes.ok
                        ? attachRes.error
                        : (attachRes.payload?.error ?? "UNKNOWN"),
                );
                setSaving(false);
                return;
            }

            vaultLog.info("Attached passkey to existing credential", {
                host: prompt.host,
            });
            await consumeAndExit("saved");
            return;
        }

        const res = await sendEncryptedEnvelopeToSW<
            | { ok: true; credential: LiteCredential }
            | { ok: false; error: string }
        >(MessageType.CreateCredential, {
            form: {
                ID: null,
                Type: isPasskey ? ItemType.Passkey : ItemType.Credentials,
                DirectoryID: "",
                Name: name.trim() || prompt.host,
                Username: username,
                Password: password,
                TOTP: null,
                Tags: "",
                URL: url,
                URLMatchMode: CredentialURLMatchMode.ExactHost,
                AdditionalURLs: [],
                Passkey: isPasskey ? prompt.passkey : null,
                Notes: "",
                CustomFields: [] as Array<{
                    ID: string;
                    Name: string;
                    Type: CustomFieldType;
                    Value: string;
                }>,
            },
        });

        if (!res.ok || !res.payload?.ok) {
            const code = !res.ok
                ? res.error
                : ((res.payload as { error?: string })?.error ?? "UNKNOWN");
            vaultLog.warn("Save-credential prompt failed", { code });
            setError(code);
            setSaving(false);
            return;
        }

        vaultLog.info("Saved credential from autofill prompt", {
            host: prompt.host,
        });
        await consumeAndExit("saved");
    };

    return (
        <div className={`flex flex-col p-4${embedded ? "" : " h-full"}`}>
            <header className="flex items-start gap-2 pb-3">
                <span className="rounded-md bg-primary/15 p-1.5 text-primary">
                    {isPasskey ? (
                        <Fingerprint className="h-4 w-4" />
                    ) : (
                        <ShieldCheck className="h-4 w-4" />
                    )}
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-sm font-semibold">
                        {isPasskey ? "Save this passkey?" : "Save this login?"}
                    </h1>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                        {isPasskey ? (
                            <>
                                Create a passwordless sign-in for{" "}
                                <strong>{prompt.host}</strong>. The passkey will
                                stay encrypted in your vault.
                            </>
                        ) : (
                            <>
                                Cryptex Vault detected a new sign-in on{" "}
                                <strong>{prompt.host}</strong>. Saving it here
                                keeps it in sync with your other devices.
                            </>
                        )}
                    </p>
                </div>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => void consumeAndExit("dismissed")}
                    className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </header>

            <div className="space-y-3">
                {isPasskey && attachmentCandidates.length > 0 && (
                    <div className="space-y-2">
                        <Label className="text-xs">Save passkey as</Label>
                        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                            <button
                                type="button"
                                aria-pressed={saveMode === "new"}
                                className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                                    saveMode === "new"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => {
                                    setSaveMode("new");
                                    setCredentialPickerOpen(false);
                                }}
                                disabled={saving}
                            >
                                New item
                            </button>
                            <button
                                type="button"
                                aria-pressed={saveMode === "existing"}
                                className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                                    saveMode === "existing"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => {
                                    setSaveMode("existing");
                                    setCredentialPickerOpen(
                                        !selectedCredential,
                                    );
                                }}
                                disabled={saving}
                            >
                                Existing login
                            </button>
                        </div>
                    </div>
                )}

                {isPasskey && saveMode === "existing" && (
                    <div className="space-y-2">
                        {selectedCredential && !credentialPickerOpen ? (
                            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                    <Check className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium">
                                        {selectedCredential.name}
                                    </span>
                                    <span className="block truncate text-[11px] text-muted-foreground">
                                        {selectedCredential.username ||
                                            selectedCredential.url}
                                    </span>
                                </span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() =>
                                        setCredentialPickerOpen(true)
                                    }
                                    disabled={saving}
                                >
                                    Change
                                </Button>
                            </div>
                        ) : (
                            <>
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        autoFocus
                                        aria-label="Search saved logins"
                                        placeholder="Search name, username, or site"
                                        className="h-9 pl-8 pr-8 text-xs"
                                        value={credentialQuery}
                                        onChange={(event) =>
                                            setCredentialQuery(
                                                event.target.value,
                                            )
                                        }
                                    />
                                    {credentialQuery && (
                                        <button
                                            type="button"
                                            aria-label="Clear search"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            onClick={() =>
                                                setCredentialQuery("")
                                            }
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                <div
                                    role="listbox"
                                    aria-label="Saved logins"
                                    className="max-h-44 overflow-y-auto rounded-md border border-border bg-background"
                                >
                                    {visibleCandidates.length > 0 ? (
                                        visibleCandidates.map((credential) => {
                                            const matchesSite =
                                                credentialMatchesPageUrl(
                                                    {
                                                        URL: credential.url,
                                                        URLMatchMode:
                                                            credential.urlMatchMode,
                                                        AdditionalURLs:
                                                            credential.additionalUrls,
                                                    },
                                                    prompt.url,
                                                );
                                            return (
                                                <button
                                                    type="button"
                                                    role="option"
                                                    aria-selected={
                                                        credential.id ===
                                                        selectedCredentialId
                                                    }
                                                    key={credential.id}
                                                    className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-2 text-left last:border-b-0 hover:bg-muted/70 focus-visible:bg-muted focus-visible:outline-none"
                                                    onClick={() => {
                                                        setSelectedCredentialId(
                                                            credential.id,
                                                        );
                                                        setCredentialPickerOpen(
                                                            false,
                                                        );
                                                        setCredentialQuery("");
                                                    }}
                                                >
                                                    <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex items-center gap-1.5">
                                                            <span className="truncate text-xs font-medium">
                                                                {
                                                                    credential.name
                                                                }
                                                            </span>
                                                            {matchesSite && (
                                                                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                                                                    This site
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="block truncate text-[10px] text-muted-foreground">
                                                            {credential.username ||
                                                                credential.url}
                                                        </span>
                                                    </span>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <p className="px-3 py-5 text-center text-[11px] text-muted-foreground">
                                            No matching login found
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] text-muted-foreground">
                                        {credentialQuery
                                            ? `${filteredCandidates.length} matching result${filteredCandidates.length === 1 ? "" : "s"}${filteredCandidates.length > 6 ? "; showing the first 6" : ""}`
                                            : `Showing ${Math.min(6, attachmentCandidates.length)} suggested of ${attachmentCandidates.length} saved logins`}
                                    </p>
                                    {selectedCredential && (
                                        <button
                                            type="button"
                                            className="shrink-0 text-[10px] font-medium text-primary hover:underline"
                                            onClick={() => {
                                                setCredentialPickerOpen(false);
                                                setCredentialQuery("");
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {saveMode === "new" && (
                    <>
                        <div className="space-y-1.5">
                            <Label htmlFor="save-name" className="text-xs">
                                Name
                            </Label>
                            <Input
                                id="save-name"
                                className="text-xs"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="save-username" className="text-xs">
                                {isPasskey ? "Account" : "Username"}
                            </Label>
                            <Input
                                id="save-username"
                                className="text-xs"
                                autoComplete="off"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </div>

                        {!isPasskey && (
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="save-password"
                                    className="text-xs"
                                >
                                    Password
                                </Label>
                                <PasswordInput
                                    id="save-password"
                                    revealed={showPassword}
                                    onRevealedChange={setShowPassword}
                                    autoComplete="off"
                                    className="text-xs"
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                />
                            </div>
                        )}

                        {isPasskey && (
                            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-muted-foreground">
                                <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
                                <span>
                                    No password is saved. Your private key
                                    remains encrypted and cannot be copied.
                                </span>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label htmlFor="save-url" className="text-xs">
                                Website
                            </Label>
                            <Input
                                id="save-url"
                                className="text-xs"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                            />
                        </div>
                    </>
                )}

                {isPasskey && saveMode === "existing" && selectedCredential && (
                    <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-muted-foreground">
                        <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
                        <span>
                            The passkey will be added to the selected login; its
                            username and password will stay unchanged.
                        </span>
                    </div>
                )}
            </div>

            {error ? (
                <p className="pt-2 text-xs text-destructive" role="alert">
                    Could not save: {error}
                </p>
            ) : null}

            <div className={`flex gap-2 pt-4${embedded ? "" : " mt-auto"}`}>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => void consumeAndExit("dismissed")}
                    disabled={saving}
                >
                    Not now
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    onClick={handleSave}
                    disabled={submitDisabled}
                >
                    {saving ? (
                        <span className="flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Saving…
                        </span>
                    ) : (
                        <span className="flex items-center gap-2">
                            {isPasskey ? (
                                <Fingerprint className="h-3.5 w-3.5" />
                            ) : (
                                <Save className="h-3.5 w-3.5" />
                            )}
                            {isPasskey && saveMode === "existing"
                                ? "Attach passkey"
                                : isPasskey
                                  ? "Save passkey"
                                  : "Save"}
                        </span>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default PopupSaveCredential;
