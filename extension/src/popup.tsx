import "./popup.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import VaultManager from "@/components/vault-manager/layout";
import { Err, err, Ok, ok } from "neverthrow";
import VaultView from "./vault-view";
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { EncryptionFormGroupSchemaType } from "@/app_lib/vault-utils/form-schemas";
import { AnyMessageResponse, Message, MessageType } from "./types/sw-messaging";

type BgState = {
    unlocked: boolean;
    metadata: { id?: number; name: string } | null;
};

const App = () => {
    const [bg, setBg] = useState<BgState>({
        unlocked: false,
        metadata: null,
    });

    useEffect(() => {
        chrome.runtime.sendMessage<Message<MessageType.GetState>, AnyMessageResponse>(
            { type: MessageType.GetState, payload: undefined },
            (res: AnyMessageResponse) => {
                if (res.type === MessageType.GetState) {
                    setBg(res.payload);
                }
            },
        );
    }, []);

    const tryDecryptVault = async (
        metadata: VaultMetadata,
        formData: EncryptionFormGroupSchemaType,
    ) => {
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
        >((resolve) => {
            chrome.runtime.sendMessage<
                Message<MessageType.Unlock>,
                AnyMessageResponse
            >(
                {
                    type: MessageType.Unlock,
                    payload: {
                        index: metadata.DBIndex,
                        form: formData,
                    },
                },
                (res: AnyMessageResponse) => {
                    if (res.type === MessageType.Unlock && res.payload.ok) {
                        // Optimistically update local UI state so we can show the unlocked view immediately
                        setBg({
                            unlocked: true,
                            metadata: {
                                id: metadata.DBIndex,
                                name: metadata.Name,
                            },
                        });
                        resolve(ok(undefined));
                    } else resolve(err("DECRYPTION_FAILED" as never));
                },
            );
        });
    };

    const handleLock = () => {
        chrome.runtime.sendMessage<Message<MessageType.Lock>, AnyMessageResponse>(
            { type: MessageType.Lock, payload: undefined },
            (res: AnyMessageResponse) => {
                if (res.type === MessageType.Lock && res.payload.ok) {
                    setBg({ unlocked: false, metadata: null });
                }
            },
        );
    };

    return (
        <div className="dark bg-background">
            {bg.unlocked && bg.metadata ? (
                <VaultView name={bg.metadata.name} lockVaultFn={handleLock} />
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
