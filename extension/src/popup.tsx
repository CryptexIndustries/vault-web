import "./vault-core-runtime";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveQuery } from "dexie-react-hooks";
import { err, ok } from "neverthrow";
import { LoaderCircle, Link2, ScrollText, Shield } from "lucide-react";

import "./popup.css";
import { type EncryptionFormGroupSchemaType } from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import * as Storage from "@/app_lib/vault-utils/storage";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

import {
    EncryptedEnvelope,
    MessageType,
    type PendingSavePrompt,
    type PlaintextEnvelope,
} from "./types/sw-messaging";
import {
    createEncryptedEnvelope,
    createPlaintextEnvelope,
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "./utils/session-utils";
import { generalLog, openLogsTab, uiLog, vaultLog } from "./utils/ext-logging";
import PopupUnlock from "./components/popup-unlock";
import PopupSaveCredential from "./components/popup-save-credential";
import VaultView from "./vault-view";
import { sendEncryptedEnvelopeToSW } from "./utils/sw-envelope-client";

const openLinkTab = () => {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.tabs) {
        uiLog.warn("Cannot open link tab outside the extension context");
        return;
    }
    void chrome.tabs.create({
        url: chrome.runtime.getURL("/link.html"),
    });
};

type BgState = {
    unlocked: boolean;
    metadata: { id?: number; name: string } | null;
};

type ServerPublicKey = {
    keyId: string;
    publicKeyJwk: JsonWebKey;
};

const App = () => {
    const [bg, setBg] = useState<BgState>({
        unlocked: false,
        metadata: null,
    });
    const [bgStateLoaded, setBgStateLoaded] = useState(false);
    const [serverPublicKey, setServerPublicKey] =
        useState<ServerPublicKey | null>(null);
    const [pendingSave, setPendingSave] = useState<PendingSavePrompt | null>(
        null,
    );

    const rawVaults = useLiveQuery(() => Storage.db.vaults.toArray());
    const hasVaults = (rawVaults?.length ?? 0) > 0;
    const vaultsLoaded = rawVaults != null;

    /**
     * Requests the server's public key for encrypted messaging.
     * @returns An error if the public key request fails, otherwise ok.
     */
    const requestServerPublicKey = async () => {
        const envelope = createPlaintextEnvelope(
            MessageType.GetPublicKey,
            null,
            "popup",
        );

        const resp: PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (!resp.payload.ok) {
            return err(
                "Failed to get public key: " +
                    (resp.payload?.error ?? "Unknown error"),
            );
        }

        setServerPublicKey({
            keyId: resp.payload.keyId,
            publicKeyJwk: resp.payload.publicKeyJwk,
        });

        return ok();
    };

    /**
     * Handles STALE_KEY error by refreshing the public key.
     * @returns An error if the public key refresh fails, otherwise ok.
     */
    const handleStaleKeyError = async () => {
        generalLog.debug("Stale key handler called, refreshing public key");

        const res = await requestServerPublicKey();

        if (res.isErr()) {
            return err("STALE_KEY_REFRESH_FAILED: " + res.error);
        }

        return ok();
    };

    useEffect(() => {
        (async () => {
            if (!serverPublicKey) {
                const res = await requestServerPublicKey();
                if (res.isErr()) {
                    generalLog.error(
                        "Failed to get server public key on popup init",
                        { error: res.error },
                    );
                    return err("Failed to get server public key: " + res.error);
                }

                if (!serverPublicKey) {
                    return err("Failed to get server public key");
                }
            }

            let retried = false;
            const fetchState = async (): Promise<void> => {
                const envelope = await createEncryptedEnvelope(
                    MessageType.GetState,
                    null,
                    serverPublicKey.publicKeyJwk,
                    serverPublicKey.keyId,
                    "popup",
                );
                const res: EncryptedEnvelope | PlaintextEnvelope =
                    await chrome.runtime.sendMessage(envelope);

                if (isEncryptedEnvelope(res)) {
                    const decryptedPayload = await decryptResponseEnvelope<{
                        unlocked: boolean;
                        metadata: { id?: number; name: string } | null;
                    }>(res);
                    if (decryptedPayload?.ok && decryptedPayload.payload) {
                        setBg({
                            unlocked: decryptedPayload.payload.unlocked,
                            metadata: decryptedPayload.payload.metadata,
                        });
                    }
                    setBgStateLoaded(true);
                    return;
                }

                if (!res.payload.ok && res.payload.error === "STALE_KEY") {
                    const retryRes = await handleStaleKeyError();
                    if (retryRes.isErr()) {
                        generalLog.error(
                            "Failed to refresh public key while fetching state",
                            { error: retryRes.error },
                        );
                        setBgStateLoaded(true);
                        return;
                    }

                    if (retried) {
                        generalLog.error(
                            "Repeated public key refresh failure while fetching state",
                        );
                        setBgStateLoaded(true);
                        return;
                    }

                    retried = true;
                    await fetchState();
                    return;
                }

                generalLog.warn(
                    "Unexpected plaintext envelope while fetching state",
                    {
                        payload: res.payload,
                    },
                );
                setBgStateLoaded(true);
            };

            await fetchState();
        })();
    }, [serverPublicKey]);

    useEffect(() => {
        if (!bg.unlocked) {
            setPendingSave(null);
            return;
        }
        let cancelled = false;
        (async () => {
            const res = await sendEncryptedEnvelopeToSW<{
                ok: true;
                prompt: PendingSavePrompt | null;
            }>(MessageType.GetPendingSavePrompt, null);
            if (cancelled) return;
            if (!res.ok || !res.payload?.ok) return;
            setPendingSave(res.payload.prompt);
        })();
        return () => {
            cancelled = true;
        };
    }, [bg.unlocked]);

    const tryDecryptVault = async (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
    ) => {
        const res = await _tryDecryptVault(metadata, formData);

        const recordSuccess = () => {
            setBg({
                unlocked: true,
                metadata: {
                    id: metadata.DBIndex,
                    name: metadata.Name,
                },
            });
            vaultLog.info("Vault unlocked", { vaultId: metadata.DBIndex });
        };

        if (res.isErr()) {
            if (res.error === "STALE_KEY") {
                const pubKeyRetry = await handleStaleKeyError();
                if (pubKeyRetry.isErr()) {
                    vaultLog.error(
                        "Failed to refresh public key while unlocking",
                        { error: pubKeyRetry.error },
                    );
                    return err(
                        ("DECRYPTION_FAILED: " +
                            pubKeyRetry.error) as "DECRYPTION_FAILED",
                    );
                }

                const retryRes = await _tryDecryptVault(metadata, formData);
                if (retryRes.isErr()) {
                    vaultLog.error("Unlock retry failed", {
                        error: retryRes.error,
                    });
                    return err(
                        ("DECRYPTION_FAILED: " +
                            retryRes.error) as "DECRYPTION_FAILED",
                    );
                }

                recordSuccess();
                return ok();
            }

            return err(
                ("DECRYPTION_FAILED: " + res.error) as "DECRYPTION_FAILED",
            );
        }

        recordSuccess();
        return ok();
    };

    const _tryDecryptVault = async (
        metadata: Storage.VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
    ) => {
        if (!serverPublicKey) {
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const envelope = await createEncryptedEnvelope(
            MessageType.Unlock,
            {
                index: metadata.DBIndex,
                form: formData,
            },
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                { ok: false; error: string } | { ok: true }
            >(res);

            if (!decryptedPayload?.ok) {
                return err("ENVELOPE_FAILED_DECRYPTION");
            }

            if (!decryptedPayload.payload.ok) {
                return err(
                    "VAULT_UNLOCK_FAILED: " + decryptedPayload.payload.error,
                );
            }

            return ok();
        }

        if (res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const handleLock = async () => {
        const res = await _handleLock();

        const recordSuccess = () => {
            setBg({ unlocked: false, metadata: null });
            vaultLog.info("Vault locked");
        };

        if (res.isOk()) {
            recordSuccess();
            return ok();
        }

        if (res.error !== "STALE_KEY") {
            return err("LOCK_VAULT_FAILED: " + res.error);
        }

        const pubKeyRetry = await handleStaleKeyError();
        if (pubKeyRetry.isErr()) {
            vaultLog.error("Failed to refresh public key while locking", {
                error: pubKeyRetry.error,
            });
            return err("LOCK_VAULT_FAILED_STALE_KEY: " + pubKeyRetry.error);
        }

        const retryRes = await _handleLock();
        if (retryRes.isErr()) {
            vaultLog.error("Lock retry failed", { error: retryRes.error });
            return err("LOCK_VAULT_FAILED_AFTER_RETRY: " + retryRes.error);
        }

        recordSuccess();
        return ok();
    };

    const _handleLock = async () => {
        if (!serverPublicKey) {
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const envelope = await createEncryptedEnvelope(
            MessageType.Lock,
            null,
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                { ok: false; error: string } | { ok: true }
            >(res);

            if (!decryptedPayload?.ok) {
                return err("ENVELOPE_FAILED_DECRYPTION");
            }

            if (!decryptedPayload.payload.ok) {
                return err(
                    "VAULT_LOCK_FAILED: " + decryptedPayload.payload.error,
                );
            }

            return ok();
        }

        if (res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const renderBody = () => {
        if (!vaultsLoaded || !bgStateLoaded) {
            return (
                <div className="flex h-full items-center justify-center p-4">
                    <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            );
        }

        if (bg.unlocked && bg.metadata) {
            if (pendingSave) {
                return (
                    <PopupSaveCredential
                        prompt={pendingSave}
                        onDone={() => setPendingSave(null)}
                    />
                );
            }
            return (
                <VaultView
                    name={bg.metadata.name}
                    lockVaultFn={handleLock}
                    serverPublicKey={serverPublicKey}
                    onStaleKeyError={handleStaleKeyError}
                />
            );
        }

        if (!hasVaults) {
            return (
                <div className="flex h-full items-center justify-center p-4">
                    <div className="flex w-full max-w-sm flex-col items-stretch gap-4 text-center">
                        <span className="mx-auto rounded-md bg-primary/15 p-2 text-primary">
                            <Shield className="h-5 w-5" />
                        </span>
                        <div className="space-y-1">
                            <h1 className="text-sm font-semibold">
                                No vault on this device
                            </h1>
                            <p className="text-[11px] leading-snug text-muted-foreground">
                                Link this browser to an existing vault from
                                another device. Linking opens in a new tab so
                                the QR scanner and progress view have enough
                                room.
                            </p>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                uiLog.info("Opening link tab from popup CTA");
                                openLinkTab();
                            }}
                        >
                            <Link2 className="mr-1 h-3.5 w-3.5" />
                            Link this device
                        </Button>
                        <p className="text-[10px] text-muted-foreground">
                            Once the linked vault is saved, this popup will
                            switch to the unlock screen automatically.
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex h-full items-center justify-center p-4">
                <div className="w-full max-w-sm">
                    <PopupUnlock onUnlock={tryDecryptVault} />
                </div>
            </div>
        );
    };

    return (
        <div className="dark flex h-full flex-col bg-background text-foreground">
            <div className="flex-1 overflow-y-auto">{renderBody()}</div>
            <footer className="flex items-center justify-between border-t bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
                <span>Cryptex Vault</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                        uiLog.debug("Opening logs tab");
                        openLogsTab();
                    }}
                >
                    <ScrollText className="h-3 w-3" />
                    Logs
                </Button>
            </footer>
            <Toaster />
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
