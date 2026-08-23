/**
 * Lightweight eTLD+1 derivation used by autofill origin context.
 *
 * A full Public Suffix List bundle would add ~30 KB to every page the
 * content script touches, so we ship a hand-curated list of multi-label
 * suffixes (ccTLD second-levels + common platform suffixes) and fall
 * back to the last-two-labels heuristic for everything else.
 *
 * Security note: this helper provides display context only. Autofill authority
 * lives in the shared credential URL matcher, which uses the full Public Suffix
 * List for explicit domain rules.
 */

/**
 * Multi-label public suffixes retained for lightweight display context.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
    // United Kingdom
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "ltd.uk",
    "me.uk",
    "net.uk",
    "nhs.uk",
    "plc.uk",
    "sch.uk",
    // Japan
    "co.jp",
    "or.jp",
    "ne.jp",
    "ac.jp",
    "go.jp",
    "lg.jp",
    "ad.jp",
    // Australia
    "com.au",
    "net.au",
    "org.au",
    "edu.au",
    "gov.au",
    "id.au",
    "asn.au",
    // New Zealand
    "co.nz",
    "net.nz",
    "org.nz",
    "ac.nz",
    "govt.nz",
    "school.nz",
    // Brazil
    "com.br",
    "net.br",
    "org.br",
    "gov.br",
    "edu.br",
    // China
    "com.cn",
    "net.cn",
    "org.cn",
    "edu.cn",
    "gov.cn",
    "ac.cn",
    // Hong Kong
    "com.hk",
    "net.hk",
    "org.hk",
    "edu.hk",
    "gov.hk",
    // India
    "co.in",
    "net.in",
    "org.in",
    "ac.in",
    "edu.in",
    "gov.in",
    // South Africa
    "co.za",
    "net.za",
    "org.za",
    "ac.za",
    // Mexico
    "com.mx",
    "org.mx",
    "edu.mx",
    "gob.mx",
    // Korea
    "co.kr",
    "or.kr",
    "ne.kr",
    "go.kr",
    // Common platform / GitHub-style suffixes
    "github.io",
    "gitlab.io",
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "azurewebsites.net",
    "cloudfront.net",
    "herokuapp.com",
    "appspot.com",
]);

/** Returns true if the host is an IPv4 literal. IPv6 is bracketed and never enters here. */
function isIPv4(host: string): boolean {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
    return host.split(".").every((part) => {
        const n = Number(part);
        return n >= 0 && n <= 255;
    });
}

/**
 * Returns the eTLD+1 of `host` (the registrable domain). For `localhost`
 * and IP addresses the input is returned unchanged so the matcher
 * treats each as its own bucket and does not collapse `127.0.0.1` with
 * `127.0.0.2`.
 */
export function etldPlus1(host: string): string {
    if (!host) return host;
    const normalised = host.toLowerCase().replace(/\.$/, "");

    if (normalised === "localhost" || isIPv4(normalised)) {
        return normalised;
    }
    if (normalised.includes(":")) {
        // Looks like an IPv6 literal that the caller forgot to bracket;
        // bail out without inventing a registrable domain.
        return normalised;
    }

    const labels = normalised.split(".");
    if (labels.length < 2) return normalised;

    const lastTwo = labels.slice(-2).join(".");
    if (labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo)) {
        return labels.slice(-3).join(".");
    }

    return lastTwo;
}

/**
 * Parses a URL-ish string (we tolerate credentials saved without a
 * scheme by prefixing `https://`) and extracts `{ host, etldPlus1 }`.
 * Returns `null` for inputs that can't be parsed.
 */
export function parseOriginish(
    input: string | undefined | null,
): { host: string; etldPlus1: string } | null {
    if (!input) return null;
    let trimmed = input.trim();
    if (!trimmed) return null;

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        trimmed = "https://" + trimmed;
    }

    try {
        const url = new URL(trimmed);
        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!host) return null;
        return { host, etldPlus1: etldPlus1(host) };
    } catch {
        return null;
    }
}
