import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";
import VaultManager from "@/components/vault-manager/layout";
import { type EncryptionFormGroupSchemaType } from "@/app_lib/vault-utils/form-schemas";
import { type VaultMetadata } from "@/app_lib/vault-utils/storage";
import { err, ok } from "neverthrow";
import {
    EncryptedEnvelope,
    MessageType,
    type PlaintextEnvelope,
} from "./types/sw-messaging";
import {
    createEncryptedEnvelope,
    createPlaintextEnvelope,
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "./utils/session-utils";
import VaultView from "./vault-view";

type BgState = {
    unlocked: boolean;
    metadata: { id?: number; name: string } | null;
};

const App = () => {
    const [bg, setBg] = useState<BgState>({
        unlocked: false,
        metadata: null,
    });
    const [serverPublicKey, setServerPublicKey] = useState<{
        keyId: string;
        publicKeyJwk: JsonWebKey;
    } | null>(null);

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
                "Failed to get public key: " + resp.payload?.error ||
                    "Unknown error",
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
        console.debug("Stale key handler called, refreshing public key...");

        const res = await requestServerPublicKey();

        if (res.isErr()) {
            return err("STALE_KEY_REFRESH_FAILED: " + res.error);
        }

        return ok();
    };

    useEffect(() => {
        const init = async () => {
            // Request server's public key
            if (!serverPublicKey) {
                const res = await requestServerPublicKey();
                if (res.isErr()) {
                    console.error(
                        "When initializing the popup, failed to get server public key: " +
                            res.error,
                    );
                    return err("Failed to get server public key: " + res.error);
                }

                // In case the request failed, the serverPublicKey is still null
                // This is just to be safe, and it makes the type checker happy
                if (!serverPublicKey) {
                    return err("Failed to get server public key");
                }
            }

            // Get current state
            {
                let _retriedGetState = false;
                const _getState = async () => {
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
                        return;
                    }

                    if (!res.payload.ok && res.payload.error === "STALE_KEY") {
                        const resRetry = await handleStaleKeyError();

                        if (resRetry.isErr()) {
                            console.error(
                                "Tried to get state, but failed to refresh public key: " +
                                    resRetry.error,
                            );
                            // TODO: Tell the user that the extension is not working correctly
                        }

                        if (_retriedGetState) {
                            // In theory, this should never happen, but we'll handle it just in case to avoid infinite recursion
                            console.error(
                                "Tried to get state, but failed to refresh public key after multiple attempts",
                            );
                            // TODO: Tell the user that the extension is not working correctly
                            return;
                        }

                        _retriedGetState = true;

                        await _getState();
                    } else {
                        console.warn(
                            "Received an unknown non-encrypted envelope:",
                            res.payload,
                        );
                    }
                };
                await _getState();
            }
        };

        void init();
    }, [serverPublicKey]);

    const tryDecryptVault = async (
        metadata: VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
    ) => {
        const res = await _tryDecryptVault(metadata, formData);

        const _successFn = () => {
            setBg({
                unlocked: true,
                metadata: {
                    id: metadata.DBIndex,
                    name: metadata.Name,
                },
            });
        }

        if (res.isErr()) {
            if (res.error === "STALE_KEY") {
                const pubKeyRetry = await handleStaleKeyError();
                if (pubKeyRetry.isErr()) {
                    console.error(
                        "Tried to decrypt vault, but failed to refresh public key: " +
                            pubKeyRetry.error,
                    );

                    // Return a generic error - we cannot continue
                    return err(("DECRYPTION_FAILED: " + pubKeyRetry.error) as "DECRYPTION_FAILED");
                }

                const resRetry = await _tryDecryptVault(metadata, formData);
                if (resRetry.isErr()) {
                    console.error(
                        "Tried to decrypt vault, but failed after retrying: " +
                            resRetry.error,
                    );

                    // Return a generic error - we cannot continue
                    return err(("DECRYPTION_FAILED: " + resRetry.error) as "DECRYPTION_FAILED");
                }

                _successFn();
                return ok();
            }

            return err(("DECRYPTION_FAILED: " + res.error) as "DECRYPTION_FAILED");
        }

        _successFn();
        return ok();
    };

    const _tryDecryptVault = async (
        metadata: VaultMetadata,
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
            const decryptedPayload = await decryptResponseEnvelope<{
                ok: false;
                error: string;
            } | {ok: true}>(res);

            if (decryptedPayload?.ok) {
                if (!decryptedPayload.payload?.ok) {
                    return err("VAULT_UNLOCK_FAILED: " + decryptedPayload.payload?.error);
                }
                
                return ok();
            }

            return err("ENVELOPE_FAILED_DECRYPTION");
        }

        if (res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const handleLock = async () => {
        if (!serverPublicKey) {
            console.error(
                "Failed to lock vault: No server public key available",
            );
            return;
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
            const decryptedPayload = await decryptResponseEnvelope<{
                ok: boolean;
            }>(res);
            if (!decryptedPayload?.ok) {
                console.error(
                    "Failed while decrypting lock vault response envelope: " +
                        decryptedPayload.error,
                );
            }
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            const pubKeyRetry = await handleStaleKeyError();
            if (pubKeyRetry.isErr()) {
                console.error(
                    "Tried to lock vault, but failed to refresh public key: " +
                        pubKeyRetry.error,
                );

                // If we failed at refreshing the public key, don't retry sending the message
                return;
            }

            const envelopeRetry = await createEncryptedEnvelope(
                MessageType.Lock,
                null,
                serverPublicKey.publicKeyJwk,
                serverPublicKey.keyId,
                "popup",
            );
            const resRetry: EncryptedEnvelope | PlaintextEnvelope =
                await chrome.runtime.sendMessage(envelopeRetry);
            if (isEncryptedEnvelope(resRetry)) {
                const decryptedPayloadRetry = await decryptResponseEnvelope<{
                    ok: boolean;
                }>(resRetry);
                if (!decryptedPayloadRetry?.ok) {
                    console.error(
                        "Failed while decrypting lock vault response envelope after retrying: " +
                            decryptedPayloadRetry.error,
                    );
                }
            }
        } else {
            console.error("Received non-encrypted envelope:", res);
        }

        setBg({ unlocked: false, metadata: null });
    };

    return (
        <div className="dark bg-background">
            {bg.unlocked && bg.metadata ? (
                <VaultView
                    name={bg.metadata.name}
                    lockVaultFn={handleLock}
                    serverPublicKey={serverPublicKey}
                    onStaleKeyError={handleStaleKeyError}
                />
            ) : (
                <VaultManager
                    tryDecryptVaultCallback={tryDecryptVault}
                    tryCreateVaultCallback={async () => false}
                    tryRestoreVaultCallback={async () => false}
                />
            )}
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
