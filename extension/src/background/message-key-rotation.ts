import * as Storage from "@/app_lib/vault-utils/storage";
import { generateECDHKeyPair } from "../utils/crypto-utils";

/**
 * Rotates the active ECDH key pair, marking the old one as decommissioned.
 */
export async function rotateKeyPair(): Promise<void> {
    try {
        const currentActiveKey = await Storage.db.keyPairs
            .where("status")
            .equals("active")
            .first();
        if (currentActiveKey) {
            // Mark current active key as decommissioned
            await Storage.db.keyPairs.update(currentActiveKey.keyId, {
                status: "decommission",
            });
        }

        // Generate new active key pair
        const newKeyPair = await generateECDHKeyPair();
        await Storage.db.keyPairs.add({
            keyId: newKeyPair.keyId,
            createdAt: newKeyPair.createdAt,
            status: "active",
            privateKey: newKeyPair.privateKey,
            publicKeyJwk: newKeyPair.publicKeyJwk,
        });

        console.debug(
            `[SW] Rotated ECDH key pair. New key ID: ${newKeyPair.keyId}`,
        );

        // TODO: Broadcast KEY_ROTATED to all connected clients (popup)
        // For now, clients will discover rotation on next request via STALE_KEY error
    } catch (error) {
        console.error("[SW] Failed to rotate key pair:", error);
        throw error;
    }
}
