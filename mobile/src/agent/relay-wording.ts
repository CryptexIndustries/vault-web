import { unknownRelayText } from "@cryptex-industries/vault-core/agent/approver";
import { sanitizeDisplayText } from "@cryptex-industries/vault-core/agent/request-check";

/**
 * A pairing code that names a relay this phone has no token for. Anyone can
 * make such a code, so the wording doesn't call it "your relay" and doesn't
 * ask for "its" token.
 */
export function unknownRelayMessage(
    relayUrl: string,
    savedRelays: readonly string[],
): string {
    const others =
        savedRelays.length === 1
            ? ` You already use your own relay at ${sanitizeDisplayText(savedRelays[0]!, 120)}. Check that this code came from your machine.`
            : savedRelays.length > 1
              ? ` You already use ${savedRelays.length} relays of your own. Check that this code came from your machine.`
              : "";
    const intro = unknownRelayText(sanitizeDisplayText(relayUrl, 160), "phone");
    return `${intro}${others} Enter an access token only if you run this relay yourself. The token stays on this phone.`;
}

/**
 * A relay this phone has a token for refused it: the relay's access token
 * changed. Only shown for relays the user saved themselves.
 */
export function refusedRelayMessage(relayUrl: string): string {
    const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(relayUrl)?.[1] ?? relayUrl;
    return `The relay at ${sanitizeDisplayText(host, 160)} didn't accept the access token saved on this phone. Enter its current access token.`;
}

/** The hosted relay refused this phone's relay pass. */
export const HOSTED_RELAY_REFUSED =
    "The Cryptex Vault relay didn't accept this phone. Check that Online Services is active, then try again.";
