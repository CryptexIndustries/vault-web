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
import { Eye, EyeOff, Loader2, Save, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
    MessageType,
    type LiteCredential,
    type PendingSavePrompt,
} from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "../utils/sw-envelope-client";
import { uiLog, vaultLog } from "../utils/ext-logging";
import {
    CustomFieldType,
    ItemType,
} from "@cryptex-industries/vault-core/proto";

export type PopupSaveCredentialProps = {
    prompt: PendingSavePrompt;
    onDone: () => void;
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

    useEffect(() => {
        setName(prompt.host);
        setUsername(prompt.username);
        setPassword(prompt.password);
        setUrl(prompt.url);
    }, [prompt]);

    const submitDisabled = useMemo(
        () => saving || !name.trim() || !password,
        [saving, name, password],
    );

    const consumeAndExit = async () => {
        try {
            await sendEncryptedEnvelopeToSW(
                MessageType.ConsumePendingSavePrompt,
                null,
            );
        } catch (err) {
            uiLog.warn("Failed to consume pending save prompt", { err });
        }
        onDone();
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
                Type: ItemType.Credentials,
                DirectoryID: "",
                Name: name.trim() || prompt.host,
                Username: username,
                Password: password,
                TOTP: null,
                Tags: "",
                URL: url,
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
        await consumeAndExit();
    };

    return (
        <div className={`flex flex-col p-4${embedded ? "" : " h-full"}`}>
            <header className="flex items-start gap-2 pb-3">
                <span className="rounded-md bg-primary/15 p-1.5 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-sm font-semibold">Save this login?</h1>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                        Cryptex Vault detected a new sign-in on{" "}
                        <strong>{prompt.host}</strong>. Saving it here keeps it
                        in sync with your other devices.
                    </p>
                </div>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={consumeAndExit}
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
                        Username
                    </Label>
                    <Input
                        id="save-username"
                        className="text-xs"
                        autoComplete="off"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="save-password" className="text-xs">
                        Password
                    </Label>
                    <div className="relative">
                        <Input
                            id="save-password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="off"
                            className="pr-9 text-xs"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                            aria-label={
                                showPassword ? "Hide password" : "Show password"
                            }
                        >
                            {showPassword ? (
                                <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                                <Eye className="h-3.5 w-3.5" />
                            )}
                        </button>
                    </div>
                </div>

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
                    onClick={consumeAndExit}
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
                            <Save className="h-3.5 w-3.5" />
                            Save
                        </span>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default PopupSaveCredential;
