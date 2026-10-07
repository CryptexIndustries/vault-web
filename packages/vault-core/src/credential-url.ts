// @ts-expect-error psl ships declarations but does not expose them in package exports.
import psl from "psl";

import { CredentialURLMatchMode, type CredentialURL } from "./proto/vault";

const ALLOWED_CREDENTIAL_URL_PROTOCOLS = new Set(["http:", "https:"]);
const ANDROID_APP_PROTOCOL = "androidapp:";
const ANDROID_PACKAGE_NAME =
    /^(?:[a-zA-Z][a-zA-Z0-9_]*\.)+[a-zA-Z][a-zA-Z0-9_]*$/;
const HTTP_URL_PREFIX = /^https?:\/\//i;
const EXPLICIT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/g;

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
    if (!match) return false;

    const scheme = match[0].slice(0, -1);
    const remainder = value.slice(match[0].length);
    const looksLikeHostPort =
        /^\d+(?:[/?#]|$)/.test(remainder) &&
        (scheme.includes(".") || scheme.toLowerCase() === "localhost");

    return !looksLikeHostPort;
}
function normalizeCredentialPattern(rawUrl?: string | null): string | null {
    const trimmedUrl = rawUrl?.trim();
    if (!trimmedUrl) return null;

    if (HTTP_URL_PREFIX.test(trimmedUrl)) {
        return parseAllowedCredentialUrl(trimmedUrl)?.toString() ?? null;
    }
    if (hasExplicitNonHttpScheme(trimmedUrl)) return null;
    return (
        parseAllowedCredentialUrl(`https://${trimmedUrl}`)?.toString() ?? null
    );
}

export function normalizeCredentialUrl(rawUrl?: string | null): string | null {
    const normalizedUrl = normalizeCredentialPattern(rawUrl);
    if (!normalizedUrl || new URL(normalizedUrl).hostname.includes("%2A")) {
        return null;
    }
    return normalizedUrl;
}

export type CredentialUrlSet = {
    URL: string;
    URLMatchMode?: CredentialURLMatchMode;
    AdditionalURLs?: readonly CredentialURL[];
};

export type CredentialUrlRule = {
    URL: string;
    MatchMode: CredentialURLMatchMode;
};

export type CredentialUrlMatch = {
    rule: CredentialUrlRule;
    priority: number;
};

export function getCredentialUrlRules(
    credential: CredentialUrlSet,
): CredentialUrlRule[] {
    return [
        {
            URL: credential.URL,
            MatchMode:
                credential.URLMatchMode ?? CredentialURLMatchMode.ExactHost,
        },
        ...(credential.AdditionalURLs ?? []),
    ].filter(({ URL }) => URL.trim().length > 0);
}

export type CredentialUrlMatchOptions = {
    /**
     * Ignore explicit ports on both the saved rule URL and the page URL.
     * Android browser autofill only exposes the page host (`webDomain`
     * carries no port), so a strict port comparison can never match a
     * credential saved with a non-default port. Web and extension callers
     * see the full page URL and should not use this.
     */
    ignorePort?: boolean;
};

/** Normalize an Android application association without treating it as a web URL. */
export function normalizeAndroidAppUri(rawUrl?: string | null): string | null {
    const trimmed = rawUrl?.trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed);
        if (
            parsed.protocol !== ANDROID_APP_PROTOCOL ||
            parsed.username ||
            parsed.password ||
            parsed.port ||
            parsed.pathname !== "" ||
            parsed.search ||
            parsed.hash ||
            !ANDROID_PACKAGE_NAME.test(parsed.hostname)
        ) {
            return null;
        }
        return `${ANDROID_APP_PROTOCOL}//${parsed.hostname.toLowerCase()}`;
    } catch {
        return null;
    }
}

function protocolsAndPortsMatch(
    saved: URL,
    page: URL,
    options?: CredentialUrlMatchOptions,
): boolean {
    if (saved.protocol === "https:" && page.protocol !== "https:") return false;
    if (options?.ignorePort) return true;
    return !(saved.port || page.port) || saved.port === page.port;
}

function normalizedHostname(url: URL): string {
    return url.hostname.toLowerCase().replace(/\.$/, "").replaceAll("%2a", "*");
}

/** Registrable domain (eTLD+1) of a hostname under the PSL, or null. */
export function registrableDomainOf(hostname: string): string | null {
    return psl.get(hostname.toLowerCase().replace(/\.$/u, ""));
}

/** True when a hostname contains a registrable domain under the PSL. */
export function isRegistrableDomain(hostname: string): boolean {
    return registrableDomainOf(hostname) !== null;
}

function escapeRegex(value: string): string {
    return value.replace(REGEX_SPECIAL, "\\$&");
}

function wildcardHostnameIsSafe(labels: readonly string[]): boolean {
    const sampleHostname = labels
        .map((label) =>
            label === "*" || label.toLowerCase() === "%2a" ? "wildcard" : label,
        )
        .join(".");
    const registrableDomain = psl.get(sampleHostname);
    if (!registrableDomain) return false;
    const registrableLabels = registrableDomain.split(".").length;
    return labels
        .slice(-registrableLabels)
        .every((label) => label !== "*" && label.toLowerCase() !== "%2a");
}

function wildcardRuleMatches(
    rawPattern: string,
    page: URL,
    options?: CredentialUrlMatchOptions,
): boolean {
    const normalizedPattern = normalizeCredentialPattern(rawPattern);
    if (!normalizedPattern) return false;
    const pattern = new URL(normalizedPattern);
    if (!protocolsAndPortsMatch(pattern, page, options)) return false;

    const labels = normalizedHostname(pattern).split(".");
    if (
        labels.length < 2 ||
        !wildcardHostnameIsSafe(labels) ||
        labels.some(
            (label) =>
                !label ||
                (label.includes("*") &&
                    label !== "*" &&
                    label.toLowerCase() !== "%2a") ||
                (!label.includes("*") && !/^[a-z0-9-]+$/i.test(label)),
        )
    ) {
        return false;
    }

    const hostnameRegex = new RegExp(
        `^${labels
            .map((label) =>
                label === "*" || label.toLowerCase() === "%2a"
                    ? "[^.]+"
                    : escapeRegex(label),
            )
            .join("\\.")}$`,
        "i",
    );
    if (!hostnameRegex.test(normalizedHostname(page))) return false;

    const pathPattern = pattern.pathname;
    if (pathPattern === "/") return true;
    const pathRegex = new RegExp(
        `^${escapeRegex(pathPattern)
            .replace(/\\\*\\\*/g, ".*")
            .replace(/\\\*/g, "[^/]*")}$`,
    );
    return pathRegex.test(page.pathname);
}

function rulePriority(
    rule: CredentialUrlRule,
    page: URL,
    options?: CredentialUrlMatchOptions,
): number {
    if (rule.MatchMode === CredentialURLMatchMode.Wildcard) {
        return wildcardRuleMatches(rule.URL, page, options) ? 2 : -1;
    }

    const normalizedSavedUrl = normalizeCredentialUrl(rule.URL);
    if (!normalizedSavedUrl) return -1;
    const saved = new URL(normalizedSavedUrl);
    if (!protocolsAndPortsMatch(saved, page, options)) return -1;

    const savedHostname = normalizedHostname(saved);
    const pageHostname = normalizedHostname(page);
    if (rule.MatchMode === CredentialURLMatchMode.ExactHost) {
        return savedHostname === pageHostname ? 3 : -1;
    }

    const savedDomain = psl.get(savedHostname);
    const pageDomain = psl.get(pageHostname);
    if (!savedDomain || !pageDomain) {
        return savedHostname === pageHostname ? 3 : -1;
    }
    return savedDomain === pageDomain ? 1 : -1;
}

export function isCredentialUrlRuleValid(rule: CredentialUrlRule): boolean {
    const androidApp = normalizeAndroidAppUri(rule.URL);
    if (androidApp) {
        return rule.MatchMode === CredentialURLMatchMode.ExactHost;
    }
    if (rule.MatchMode === CredentialURLMatchMode.Wildcard) {
        const sentinel = normalizeCredentialPattern(rule.URL);
        if (!sentinel) return false;
        const pattern = new URL(sentinel);
        const labels = normalizedHostname(pattern).split(".");

        return (
            labels.length >= 2 &&
            labels.some(
                (label) => label === "*" || label.toLowerCase() === "%2a",
            ) &&
            labels.every(
                (label) => label === "*" || /^[a-z0-9-]+$/i.test(label),
            ) &&
            wildcardHostnameIsSafe(labels)
        );
    }
    return normalizeCredentialUrl(rule.URL) !== null;
}

/** Match a saved application association. Web match modes never cross into apps. */
export function credentialMatchesAndroidApp(
    credential: CredentialUrlSet,
    packageName: string,
): boolean {
    if (!ANDROID_PACKAGE_NAME.test(packageName)) return false;
    const target = `${ANDROID_APP_PROTOCOL}//${packageName.toLowerCase()}`;
    return getCredentialUrlRules(credential).some(
        (rule) =>
            rule.MatchMode === CredentialURLMatchMode.ExactHost &&
            normalizeAndroidAppUri(rule.URL) === target,
    );
}

function credentialUrlRuleKey(rule: CredentialUrlRule): string {
    const normalizedUrl =
        (rule.MatchMode === CredentialURLMatchMode.Wildcard
            ? normalizeCredentialPattern(rule.URL)
            : normalizeCredentialUrl(rule.URL)
        )?.toLowerCase() ?? rule.URL.trim().toLowerCase();
    return `${rule.MatchMode}:${normalizedUrl}`;
}

export function sanitizeAdditionalCredentialUrls(
    primaryRule: CredentialUrlRule,
    additionalRules: readonly (CredentialURL | string)[] | undefined,
): CredentialURL[] {
    const primaryKey = credentialUrlRuleKey(primaryRule);
    const seen = new Set([primaryKey]);
    const sanitized: CredentialURL[] = [];

    for (const rule of additionalRules ?? []) {
        const next =
            typeof rule === "string"
                ? {
                      URL: rule.trim(),
                      MatchMode: CredentialURLMatchMode.ExactHost,
                  }
                : {
                      URL: rule.URL.trim(),
                      MatchMode: rule.MatchMode,
                  };
        const key = credentialUrlRuleKey(next);
        if (!isCredentialUrlRuleValid(next) || seen.has(key)) continue;
        seen.add(key);
        sanitized.push(next);
    }

    return sanitized;
}

export function findCredentialUrlMatch(
    credential: CredentialUrlSet,
    pageUrl: string,
    options?: CredentialUrlMatchOptions,
): CredentialUrlMatch | null {
    const normalizedPageUrl = normalizeCredentialUrl(pageUrl);
    if (!normalizedPageUrl) return null;
    const page = new URL(normalizedPageUrl);
    let best: CredentialUrlMatch | null = null;

    for (const rule of getCredentialUrlRules(credential)) {
        const priority = rulePriority(rule, page, options);
        if (priority > (best?.priority ?? -1)) best = { rule, priority };
    }

    return best;
}

export function credentialMatchesPageUrl(
    credential: CredentialUrlSet,
    pageUrl: string,
    options?: CredentialUrlMatchOptions,
): boolean {
    return findCredentialUrlMatch(credential, pageUrl, options) !== null;
}
