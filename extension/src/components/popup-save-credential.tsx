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
import { Fingerprint, Loader2, Save, ShieldCheck, X } from "lucide-react";

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
    const isPasskey = prompt.kind === "passkey";

    useEffect(() => {
        setName(prompt.passkey?.RPName ?? prompt.host);
        setUsername(prompt.passkey?.UserName ?? prompt.username);
        setPassword(prompt.password);
        setUrl(prompt.url);
        setShowPassword(false);
    }, [prompt]);

    const submitDisabled = useMemo(
        () => saving || !name.trim() || (!isPasskey && !password),
        [saving, name, password, isPasskey],
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
                        <Label htmlFor="save-password" className="text-xs">
                            Password
                        </Label>
                        <PasswordInput
                            id="save-password"
                            revealed={showPassword}
                            onRevealedChange={setShowPassword}
                            autoComplete="off"
                            className="text-xs"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                )}

                {isPasskey && (
                    <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-muted-foreground">
                        <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
                        <span>
                            No password is saved. Your private key remains
                            encrypted and cannot be copied.
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
                            {isPasskey ? "Save passkey" : "Save"}
                        </span>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default PopupSaveCredential;
