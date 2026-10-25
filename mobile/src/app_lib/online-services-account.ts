import {
    parseJwkFromString,
    signChallenge,
} from "@cryptex-industries/vault-core/vault-utils/device-signing-key";
import { trpc } from "@/utils/trpc";

/** Deletes the signed-in account. The server cancels a Stripe subscription, not a Google Play one. */
export async function deleteOnlineServicesAccount(privateKeyJWK: string) {
    const challenge = await trpc.v1.user.deleteChallenge.mutate();
    const signature = await signChallenge(
        parseJwkFromString(privateKeyJWK),
        Uint8Array.fromBase64(challenge.challenge),
    );
    await trpc.v1.user.delete.mutate({
        challengeId: challenge.challengeId,
        signature,
    });
}
