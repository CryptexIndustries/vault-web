import * as Storage from "@/app_lib/vault-utils/storage";
import { generateECDHKeyPair } from "../utils/crypto-utils";
import { generalLog } from "../utils/ext-logging";

/**
 * Rotates the active ECDH key pair, marking the old one as decommissioned.
 */
export async function rotateKeyPair(): Promise<void> {
    try {
        // WebCrypto can't run inside a Dexie transaction, so this comes first.
        const newKeyPair = await generateECDHKeyPair();
        await Storage.db.transaction("rw", Storage.db.keyPairs, async () => {
            await Storage.db.keyPairs
                .where("status")
                .equals("active")
                .modify({ status: "decommission" });
            await Storage.db.keyPairs.add({
                keyId: newKeyPair.keyId,
                createdAt: newKeyPair.createdAt,
                status: "active",
                privateKey: newKeyPair.privateKey,
                publicKeyJwk: newKeyPair.publicKeyJwk,
            });
        });

        console.debug(
            `[SW] Rotated ECDH key pair. New key ID: ${newKeyPair.keyId}`,
        );

        // TODO: Broadcast KEY_ROTATED to all connected clients (popup)
        // For now, clients will discover rotation on next request via STALE_KEY error
    } catch (error) {
        generalLog.error("Failed to rotate key pair", error);
        throw error;
    }
}
