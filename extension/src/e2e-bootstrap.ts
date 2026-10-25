import "./vault-core-runtime";

import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@cryptex-industries/vault-core/proto";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_PBKDF2 } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    createShareLinkRecord,
    updateShareLinkRecord,
} from "@cryptex-industries/vault-core/vault-utils/share-records";
import * as Storage from "@/app_lib/vault-utils/storage";
import { rotateKeyPair } from "./background/message-key-rotation";

const status = document.querySelector<HTMLOutputElement>("#status")!;

const DAY = 24 * 60 * 60 * 1000;

/**
 * `?shareLinks=N` seeds N sender records in a repeating mix: active, opened,
 * revoked, expired, and opened 120 days ago (past the 90-day retention).
 * Their server is the fixture origin, which has no share API.
 */
async function seedShareLinks(
    count: number,
): Promise<VaultUtilTypes.ShareLink[]> {
    const now = Date.now();
    const origin = location.search.includes("shareOrigin=")
        ? new URLSearchParams(location.search).get("shareOrigin")!
        : "http://127.0.0.1:4173";
    return Promise.all(
        Array.from({ length: count }, async (_, index) => {
            const created = now - index * 60_000;
            const record = await createShareLinkRecord({
                id: `e2e-share-${String(index).padStart(10, "0")}`,
                serverOrigin: origin,
                manageToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                credentialId: "",
                label: `Shared link ${index}`,
                expiresAt: created + 7 * DAY,
                passphrase: index % 7 === 0,
                now: created,
            });
            switch (index % 5) {
                case 1:
                    return updateShareLinkRecord(record, {
                        Status: "viewed",
                        ViewedAtTimestamp: created + 60_000,
                    });
                case 2:
                    return updateShareLinkRecord(record, { Status: "revoked" });
                case 3:
                    return updateShareLinkRecord(record, { Status: "expired" });
                case 4:
                    return updateShareLinkRecord(record, {
                        Status: "viewed",
                        ViewedAtTimestamp: now - 120 * DAY,
                    });
                default:
                    return record;
            }
        }),
    );
}
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
        const shareLinkCount = Number(
            new URLSearchParams(location.search).get("shareLinks") ?? 0,
        );
        if (shareLinkCount > 0) {
            vault.ShareLinks = await seedShareLinks(shareLinkCount);
        }
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

// Rotates the worker's envelope key the same way the 30-day rotation does,
// so tests can exercise the STALE_KEY recovery of pages that hold the old key.
const rotateKeyButton =
    document.querySelector<HTMLButtonElement>("#rotate-key")!;

rotateKeyButton.addEventListener("click", () => {
    rotateKeyButton.disabled = true;
    status.value = "Rotating…";

    void (async () => {
        if (import.meta.env.MODE !== "development") {
            throw new Error("E2E bootstrap is development-only");
        }

        await rotateKeyPair();
        const active = await Storage.db.keyPairs
            .where("status")
            .equals("active")
            .first();
        status.value = `Active key ${active?.keyId ?? "missing"}`;
    })()
        .catch((error: unknown) => {
            status.value = `Error: ${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => {
            rotateKeyButton.disabled = false;
        });
});
