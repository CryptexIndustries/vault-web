import { CredentialConstants } from "@cryptex-industries/vault-core/consts";

import type { LiteCredential } from "../types/sw-messaging";

const SEARCH_FIELDS = ["name", "tag", "note"] as const;
type SearchField = (typeof SEARCH_FIELDS)[number];

function parseTags(tags?: string): string[] {
    if (!tags) return [];
    return tags
        .split(CredentialConstants.TAG_SEPARATOR)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function parseSearchQuery(query: string) {
    const terms: Record<SearchField, string[]> = {
        name: [],
        tag: [],
        note: [],
    };

    const remaining = query.replace(
        /(^|\s)(name|tag|note):((?:"[^"]*"|[^,\s]+)(?:\s*,\s*(?:"[^"]*"|[^,\s]+))*)/g,
        (_match, whitespace: string, field: SearchField, raw: string) => {
            for (const part of raw.matchAll(/"([^"]*)"|([^,]+)/g)) {
                const value = (part[1] ?? part[2] ?? "").trim();
                if (value) terms[field].push(value);
            }
            return whitespace;
        },
    );

    const freeText = remaining
        .replace(/(^|\s)(name|tag|note):\s*$/i, "$1")
        .trim()
        .replace(/\s+/g, " ");

    return { terms, freeText };
}

function includesCaseInsensitive(haystack: string, needle: string) {
    return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function matchesAny(terms: string[], values: string[]) {
    return (
        terms.length === 0 ||
        terms.some((term) =>
            values.some((value) => includesCaseInsensitive(value, term)),
        )
    );
}

/** Matches the web app's free-text and name:/tag:/note: query semantics. */
export function credentialMatchesSearch(
    credential: LiteCredential,
    query: string,
): boolean {
    const { terms, freeText } = parseSearchQuery(query);
    const tags = parseTags(credential.tags);

    const freeTextMatches =
        !freeText ||
        [
            credential.name,
            credential.username,
            credential.notes ?? "",
            credential.passkey?.RPID ?? "",
            credential.passkey?.UserName ?? "",
            credential.passkey?.UserDisplayName ?? "",
            ...tags,
        ].some((value) => includesCaseInsensitive(value, freeText));

    return (
        freeTextMatches &&
        matchesAny(terms.name, [credential.name]) &&
        matchesAny(terms.tag, tags) &&
        matchesAny(terms.note, [credential.notes ?? ""])
    );
}
