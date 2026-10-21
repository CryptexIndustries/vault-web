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
