import "./vault-core-runtime";

import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_PBKDF2 } from "@cryptex-industries/vault-core/vault-utils/encryption";
import * as Storage from "@/app_lib/vault-utils/storage";

const status = document.querySelector<HTMLOutputElement>("#status")!;
const seedButton = document.querySelector<HTMLButtonElement>("#seed")!;

seedButton.addEventListener("click", () => {
    seedButton.disabled = true;
    status.value = "Seeding…";

    void (async () => {
        if (import.meta.env.MODE !== "development") {
            throw new Error("E2E bootstrap is development-only");
        }

        await Storage.db.vaults.clear();
        await chrome.storage.session.clear();
        await chrome.storage.local.clear();

        const { metadata, dek, vault } =
            await Storage.VaultMetadata.createNewVault(
                { Name: "Playwright vault", Description: "E2E fixture" },
                {
                    Secret: "e2e-vault-password",
                    Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
                    EncryptionKeyDerivationFunction:
                        KeyDerivationFunction.Argon2ID,
                    EncryptionConfig: {
                        iterations:
                            KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                        memLimit: 1,
                        opsLimit: 1,
                    },
                },
            );
        await metadata.save(vault, dek);
        status.value = `Seeded vault ${metadata.DBIndex}`;
    })()
        .catch((error: unknown) => {
            status.value = `Error: ${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => {
            seedButton.disabled = false;
        });
});
