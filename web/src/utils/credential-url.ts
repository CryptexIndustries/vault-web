const ALLOWED_CREDENTIAL_URL_PROTOCOLS = new Set(["http:", "https:"]);
const HTTP_URL_PREFIX = /^https?:\/\//i;
const EXPLICIT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function parseAllowedCredentialUrl(value: string): URL | null {
    try {
        const url = new URL(value);
        return ALLOWED_CREDENTIAL_URL_PROTOCOLS.has(url.protocol) ? url : null;
    } catch {
        return null;
    }
}

function hasExplicitNonHttpScheme(value: string): boolean {
    const match = value.match(EXPLICIT_SCHEME);
    if (!match) {
        return false;
    }

    const scheme = match[0].slice(0, -1);
    const remainder = value.slice(match[0].length);
    const looksLikeHostPort =
        /^\d+(?:[/?#]|$)/.test(remainder) &&
        (scheme.includes(".") || scheme.toLowerCase() === "localhost");

    return !looksLikeHostPort;
}

export function normalizeCredentialUrl(rawUrl?: string | null): string | null {
    const trimmedUrl = rawUrl?.trim();
    if (!trimmedUrl) {
        return null;
    }

    if (HTTP_URL_PREFIX.test(trimmedUrl)) {
        return parseAllowedCredentialUrl(trimmedUrl)?.toString() ?? null;
    }

    if (hasExplicitNonHttpScheme(trimmedUrl)) {
        return null;
    }

    return parseAllowedCredentialUrl(`https://${trimmedUrl}`)?.toString() ?? null;
}
