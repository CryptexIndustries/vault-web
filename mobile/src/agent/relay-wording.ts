import { plural, t } from "@lingui/core/macro";
import { relayUrlHost } from "@cryptex-industries/vault-core/agent/approver";
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
    const host = relayUrlHost(sanitizeDisplayText(relayUrl, 160));
    const intro = t`This code uses a relay at ${host} that this phone doesn't know.`;
    if (savedRelays.length === 1) {
        const relay = sanitizeDisplayText(savedRelays[0]!, 120);
        return t`${intro} You already use your own relay at ${relay}. Check that this code came from your machine. Enter an access token only if you run this relay yourself. The token stays on this phone.`;
    }
    const count = savedRelays.length;
    if (count > 1)
        return plural(count, {
            one: `${intro} You already use # relay of your own. Check that this code came from your machine. Enter an access token only if you run this relay yourself. The token stays on this phone.`,
            other: `${intro} You already use # relays of your own. Check that this code came from your machine. Enter an access token only if you run this relay yourself. The token stays on this phone.`,
        });
    return t`${intro} Enter an access token only if you run this relay yourself. The token stays on this phone.`;
}

/**
 * A relay this phone has a token for refused it: the relay's access token
 * changed. Only shown for relays the user saved themselves.
 */
export function refusedRelayMessage(relayUrl: string): string {
    const host = sanitizeDisplayText(relayUrlHost(relayUrl), 160);
    return t`The relay at ${host} didn't accept the access token saved on this phone. Enter its current access token.`;
}

/** The hosted relay refused this phone's relay pass. */
export function hostedRelayRefusedMessage(): string {
    return t`The Cryptex Vault relay didn't accept this phone. Check that Online Services is active, then try again.`;
}
