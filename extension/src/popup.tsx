import "./popup.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import VaultManager from "@/components/vault-manager/layout";
import { Err, err, Ok, ok } from "neverthrow";
import VaultView from "./vault-view";
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { EncryptionFormGroupSchemaType } from "@/app_lib/vault-utils/form-schemas";
import { MessageType, EncryptedEnvelope, PlaintextEnvelope } from "./types/sw-messaging";
import {
    createEncryptedEnvelope,
    createPlaintextEnvelope,
    decryptResponseEnvelope,
    isEncryptedEnvelope,
    discardSessionKey,
} from "./utils/session-utils";

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
     */
    const requestServerPublicKey = async (): Promise<void> => {
        return new Promise((resolve, reject) => {
            const envelope = createPlaintextEnvelope(MessageType.GetPublicKey, undefined, "popup");
            chrome.runtime.sendMessage(envelope, (response: PlaintextEnvelope) => {
                if (response.payload?.ok) {
                    setServerPublicKey({
                        keyId: response.payload.keyId,
                        publicKeyJwk: response.payload.publicKeyJwk,
                    });
                    resolve();
                } else {
                    reject(new Error(response.payload?.error || "Failed to get public key"));
                }
            });
        });
    };

    /**
     * Handles STALE_KEY error by refreshing the public key and retrying the operation.
     */
    const handleStaleKeyError = async (retryFn: () => void): Promise<void> => {
        try {
            console.log("Detected stale key, refreshing public key...");
            await requestServerPublicKey();
            // Retry the original operation
            retryFn();
        } catch (error) {
            console.error("Failed to refresh public key after STALE_KEY error:", error);
        }
    };

    useEffect(() => {
        const init = async () => {
            // Ensure offscreen document is available
            await new Promise<void>((resolve) => {
                const envelope = createPlaintextEnvelope(MessageType.EnsureOffscreen, undefined, "popup");
                chrome.runtime.sendMessage(envelope, () => resolve());
            });

            // Request server's public key
            try {
                await requestServerPublicKey();
            } catch (error) {
                console.error("Failed to get server public key:", error);
                // Continue anyway - some operations might still work
            }

            // Get current state
            const stateEnvelope = createPlaintextEnvelope(MessageType.GetState, undefined, "popup");
            chrome.runtime.sendMessage(stateEnvelope, (res: PlaintextEnvelope) => {
                if (res.payload) {
                    setBg(res.payload);
                }
            });
        };

        void init();
    }, []);

    const tryDecryptVault = async (
        metadata: VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
    ) => {
        if (!serverPublicKey) {
            // FIXME: Propagate the error to the caller instead of resolving with a generic error
            return err("DECRYPTION_FAILED");
        }

        return await new Promise<
            | Err<
                  never,
                  | "VAULT_BLOB_NULL"
                  | "VAULT_BLOB_INVALID_TYPE"
                  | "KEY_DERIVATION_FN_CONFIG_UNDEFINED"
                  | "KEY_DERIVATION_FN_INVALID"
                  | "DECRYPTION_FAILED"
                  | "ENCRYPTION_ALGORITHM_INVALID"
              >
            | Ok<void, never>
        >(async (resolve) => {
            try {
                const envelope = await createEncryptedEnvelope(
                    MessageType.Unlock,
                    {
                        index: metadata.DBIndex,
                        form: formData,
                    },
                    serverPublicKey.publicKeyJwk,
                    serverPublicKey.keyId,
                    "popup"
                );

                chrome.runtime.sendMessage(envelope, async (res: EncryptedEnvelope | PlaintextEnvelope) => {
                    if (isEncryptedEnvelope(res)) {
                        try {
                            const decryptedPayload = await decryptResponseEnvelope<{ ok: boolean }>(res);

                            if (decryptedPayload?.ok) {
                                setBg({
                                    unlocked: true,
                                    metadata: {
                                        id: metadata.DBIndex,
                                        name: metadata.Name,
                                    },
                                });
                                // We successfully decrypted the vault, so we can resolve the promise
                                // Passing undefined because we don't need to return any value
                                resolve(ok(undefined));
                                return;
                            }

                            resolve(err("DECRYPTION_FAILED"));
                            return;
                        } catch (error) {
                            // FIXME: Propagate the error to the caller instead of resolving with a generic error
                            console.error("Failed to decrypt response envelope:", error);
                            discardSessionKey(envelope.requestId);
                            resolve(err("DECRYPTION_FAILED"));
                            return;
                        }
                    } else {
                        if (res.payload?.ok && res.payload?.code === "STALE_KEY") {
                            // TODO: Check if this flow is correct
                            await handleStaleKeyError(() => tryDecryptVault(metadata, formData));
                            resolve(ok(undefined));
                            return;
                        }

                        // FIXME: Propagate the error to the caller instead of resolving with a generic error
                        console.error("Received non-encrypted envelope:", res);
                        resolve(err("DECRYPTION_FAILED"));
                    }
                });
            } catch (error) {
                // FIXME: Propagate the error to the caller instead of resolving with a generic error
                console.error("Failed to create encrypted envelope:", error);
                resolve(err("DECRYPTION_FAILED" as never));
            }
        });
    };

    const handleLock = () => {
        const envelope = createPlaintextEnvelope(MessageType.Lock, undefined, "popup");
        chrome.runtime.sendMessage(envelope, (res: PlaintextEnvelope) => {
            if (res.payload?.ok) {
                setBg({ unlocked: false, metadata: null });
            }
        });
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
