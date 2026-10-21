/**
 * Only the app itself may open the SSH approval screen. Any app or web page
 * can launch cryptex:// links, so app/+native-intent.tsx sends external
 * agent-request links to the vault home, and the screen also wants a token
 * that only openApproval() hands out (in memory, gone on restart).
 */

/**
 * Approve stays off this long after each request appears, so a tap meant for
 * whatever was on screen before can't approve it (browsers do the same on
 * their permission prompts).
 */
export const APPROVE_DELAY_MS = 700;

const tokens = new Set<string>();

export function issueApprovalToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    tokens.add(token);
    // Openings are rare; keep the set from growing without bound.
    if (tokens.size > 32) tokens.delete(tokens.values().next().value!);
    return token;
}

export function isApprovalToken(token: string | undefined): boolean {
    return !!token && tokens.has(token);
}

/** Path segments of a system URL, without scheme, groups or query. */
function routeSegments(url: string): string[] {
    let text = url.trim();
    try {
        text = decodeURIComponent(text);
    } catch {
        // Keep the raw text; a malformed escape can't hide a segment then.
    }
    text = text.replace(/^[a-z][a-z0-9+.-]*:/i, "");
    text = text.split(/[?#]/)[0] ?? "";
    return text
        .split("/")
        .map((segment) => segment.trim().toLowerCase())
        .filter((segment) => segment && !/^\(.*\)$/.test(segment));
}

/** For +native-intent: external links never open the approval screen. */
export function redirectExternalPath(path: string): string {
    return routeSegments(path).includes("agent-request") ? "/" : path;
}
