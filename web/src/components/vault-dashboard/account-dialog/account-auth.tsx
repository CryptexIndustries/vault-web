"use client";

import { Loader2 } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";

import { env } from "@/env/public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { RecoveryPhraseInput } from "./recovery-phrase-input";
import type { AuthMode } from "./types";

type AccountAuthProps = {
    authMode: AuthMode;
    onAuthModeChange: (mode: AuthMode) => void;
    registerCaptcha: string;
    onRegisterCaptcha: (token: string) => void;
    recoverCaptcha: string;
    onRecoverCaptcha: (token: string) => void;
    recoverUserId: string;
    onRecoverUserIdChange: (value: string) => void;
    recoverPhrase: string;
    onRecoverPhraseChange: (value: string) => void;
    onRegister: () => void;
    onRecover: () => void;
    registerPending: boolean;
    recoverPending: boolean;
    busy: boolean;
    purchaseAutoRegister?: boolean;
    registrationRetryRequired?: boolean;
    registerChallengeKey?: number;
    onRetryRegistration?: () => void;
};

export function AccountAuth({
    authMode,
    onAuthModeChange,
    registerCaptcha,
    onRegisterCaptcha,
    recoverCaptcha,
    onRecoverCaptcha,
    recoverUserId,
    onRecoverUserIdChange,
    recoverPhrase,
    onRecoverPhraseChange,
    onRegister,
    onRecover,
    registerPending,
    recoverPending,
    busy,
    purchaseAutoRegister,
    registrationRetryRequired,
    registerChallengeKey,
    onRetryRegistration,
}: AccountAuthProps) {
    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
                {(
                    [
                        ["register", "Create account"],
                        ["recover", "Recover account"],
                    ] as const
                ).map(([mode, label]) => (
                    <button
                        key={mode}
                        type="button"
                        className={cn(
                            "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                            authMode === mode
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => onAuthModeChange(mode)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {authMode === "register" ? (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {purchaseAutoRegister
                            ? "Completing verification creates an Online Services account for sync and billing. Your keys stay in this vault."
                            : "Create an Online Services account for sync, billing, and device linking. Keys stay in this vault."}
                    </p>
                    <Turnstile
                        key={registerChallengeKey}
                        siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                        options={{ action: "auth_register" }}
                        onSuccess={onRegisterCaptcha}
                        onExpire={() => onRegisterCaptcha("")}
                        onError={() => onRegisterCaptcha("")}
                    />
                    {purchaseAutoRegister ? (
                        registrationRetryRequired ? (
                            <Button
                                className="w-full sm:w-auto"
                                onClick={onRetryRegistration}
                                disabled={busy}
                            >
                                Retry with fresh verification
                            </Button>
                        ) : registerPending ? (
                            <p className="flex items-center gap-2 text-sm">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Creating account...
                            </p>
                        ) : null
                    ) : (
                        <Button
                            className="w-full sm:w-auto"
                            onClick={onRegister}
                            disabled={busy || !registerCaptcha}
                        >
                            {registerPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Register & sign in
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Restore access with your User ID and recovery phrase.
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor="recover-user">User ID</Label>
                        <Input
                            id="recover-user"
                            value={recoverUserId}
                            onChange={(e) =>
                                onRecoverUserIdChange(e.target.value)
                            }
                            placeholder="Your user ID"
                            autoComplete="off"
                        />
                    </div>
                    <RecoveryPhraseInput
                        value={recoverPhrase}
                        onChange={onRecoverPhraseChange}
                        disabled={busy}
                    />
                    <Turnstile
                        siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                        options={{ action: "auth_recover" }}
                        onSuccess={onRecoverCaptcha}
                    />
                    <Button
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={onRecover}
                        disabled={busy || !recoverCaptcha}
                    >
                        {recoverPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Recover account
                    </Button>
                </div>
            )}
        </div>
    );
}
