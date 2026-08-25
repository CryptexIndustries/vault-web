import { useEffect, useState } from "react";
import { KeyRound, Laptop } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
    MessageType,
    type CompletePasskeyAssertionResponse,
    type PendingPasskeyAssertion,
} from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "../utils/sw-envelope-client";

export default function PopupPasskeyAssertion({
    pending,
}: {
    pending: PendingPasskeyAssertion;
}) {
    const [selected, setSelected] = useState(
        pending.candidates[0]?.credentialId ?? "",
    );
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const port = chrome.runtime.connect({
            name: `passkey-confirmation:${pending.ceremonyId}`,
        });
        return () => port.disconnect();
    }, [pending.ceremonyId]);

    const complete = async () => {
        if (!selected || busy || (pending.requiresPassword && !password))
            return;
        setBusy(true);
        setError("");
        const result =
            await sendEncryptedEnvelopeToSW<CompletePasskeyAssertionResponse>(
                MessageType.CompletePasskeyAssertion,
                {
                    ceremonyId: pending.ceremonyId,
                    credentialId: selected,
                    vaultPassword: password,
                },
            );
        setPassword("");
        const response = result.ok ? result.payload : null;
        if (!response?.ok) {
            setBusy(false);
            setError(
                response?.error === "INVALID_VAULT_PASSWORD"
                    ? "Incorrect vault password. Try again."
                    : "Cryptex could not use this passkey.",
            );
            return;
        }
        window.close();
    };

    const decline = async () => {
        if (busy) return;
        setBusy(true);
        await sendEncryptedEnvelopeToSW(MessageType.DeclinePasskeyAssertion, {
            ceremonyId: pending.ceremonyId,
        });
        window.close();
    };

    return (
        <main className="space-y-3 p-4">
            <div className="flex items-start gap-3">
                <span className="rounded-full bg-primary/15 p-2 text-primary">
                    <KeyRound className="h-4 w-4" />
                </span>
                <div>
                    <h1 className="text-sm font-semibold">Use a passkey</h1>
                    <p className="text-xs text-muted-foreground">
                        Sign in to {pending.rpId}
                    </p>
                </div>
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto">
                {pending.candidates.map((candidate) => (
                    <label
                        key={candidate.credentialId}
                        className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${selected === candidate.credentialId ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"}`}
                    >
                        <input
                            className="sr-only"
                            type="radio"
                            name="passkey"
                            checked={selected === candidate.credentialId}
                            onChange={() => setSelected(candidate.credentialId)}
                        />
                        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                                {candidate.userDisplayName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                                {candidate.userName}
                            </span>
                        </span>
                    </label>
                ))}
            </div>

            {pending.requiresPassword && (
                <div>
                    <label
                        htmlFor="passkey-vault-password"
                        className="mb-1 block text-xs font-medium"
                    >
                        Vault password
                    </label>
                    <PasswordInput
                        id="passkey-vault-password"
                        autoComplete="current-password"
                        autoFocus
                        placeholder="Vault password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") void complete();
                        }}
                    />
                </div>
            )}

            {error && (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            )}

            <Button
                className="w-full"
                disabled={
                    !selected || busy || (pending.requiresPassword && !password)
                }
                onClick={() => void complete()}
            >
                {busy ? "Verifying…" : "Continue"}
            </Button>
            <Button
                className="w-full"
                variant="ghost"
                disabled={busy}
                onClick={() => void decline()}
            >
                <Laptop className="mr-2 h-4 w-4" />
                Use another passkey
            </Button>
        </main>
    );
}
