import { useEffect, useState } from "react";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function ShareServerSettingsForm({
    settings,
    allowCustomServer,
    defaultOrigin,
    onSave,
}: {
    settings: VaultUtilTypes.ShareSettings | undefined;
    allowCustomServer: boolean;
    defaultOrigin: string;
    onSave: (settings: VaultUtilTypes.ShareSettings) => Promise<void>;
}) {
    const [origin, setOrigin] = useState("");
    const [token, setToken] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setOrigin(settings?.ServerOrigin ?? "");
        setToken(settings?.CreationToken ?? "");
    }, [settings]);

    const save = async () => {
        setError("");
        let serverOrigin = "";
        if (allowCustomServer && origin.trim()) {
            try {
                const url = new URL(origin.trim());
                const local =
                    url.hostname === "localhost" ||
                    url.hostname === "127.0.0.1";
                if (url.protocol !== "https:" && !local) {
                    setError("Use an https:// address.");
                    return;
                }
                serverOrigin = url.origin;
            } catch {
                setError(
                    "Enter a full address, like https://vault.example.com.",
                );
                return;
            }
        }
        setSaving(true);
        try {
            await onSave({
                ServerOrigin: serverOrigin,
                CreationToken: token.trim(),
            });
        } catch {
            setError("Couldn't save the share server settings.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            {allowCustomServer ? (
                <div className="space-y-2">
                    <Label htmlFor="share-server-origin">Share server</Label>
                    <Input
                        id="share-server-origin"
                        value={origin}
                        placeholder={originPlaceholder(defaultOrigin)}
                        inputMode="url"
                        autoComplete="off"
                        onChange={(event) => setOrigin(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Leave empty to use the Cryptex Vault server, which needs
                        Online Services.
                    </p>
                </div>
            ) : null}
            <div className="space-y-2">
                <Label htmlFor="share-server-token">Creation token</Label>
                <PasswordInput
                    id="share-server-token"
                    value={token}
                    autoComplete="off"
                    secretLabel="creation token"
                    placeholder="Only for self-hosted servers"
                    onChange={(event) => setToken(event.target.value)}
                />
            </div>
            {error ? (
                <p className="text-sm text-destructive" role="alert">
                    {error}
                </p>
            ) : null}
            <Button
                variant="outline"
                disabled={saving}
                onClick={() => void save()}
            >
                {saving ? "Saving…" : "Save"}
            </Button>
        </div>
    );
}

function originPlaceholder(defaultOrigin: string): string {
    try {
        return new URL(defaultOrigin).origin;
    } catch {
        return "https://vault.example.com";
    }
}
