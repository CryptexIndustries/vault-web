import { CredentialConstants } from "@cryptex-industries/vault-core/consts";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";

type ParsedSearchQuery = {
    nameTerms: string[];
    tagTerms: string[];
    noteTerms: string[];
    freeText: string;
};

export type CredentialSort =
    | "name-asc"
    | "name-desc"
    | "modified-desc"
    | "modified-asc";

export function parseTags(tags?: string): string[] {
    if (!tags) return [];
    return tags
        .split(CredentialConstants.TAG_SEPARATOR)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function parseIdentifierValues(rawValue: string): string[] {
    const values: string[] = [];
    const valueRegex = /"([^"]*)"|([^,]+)/g;
    let match: RegExpExecArray | null;

    while ((match = valueRegex.exec(rawValue)) !== null) {
        const quotedValue = match[1];
        const plainValue = match[2];
        const value = (quotedValue ?? plainValue ?? "").trim();
        if (value) values.push(value);
    }

    return values;
}

const SEARCH_FIELDS = ["name", "tag", "note"] as const;

/** Complete only the trailing token, just like the web search input. */
export function searchFieldSuggestions(query: string) {
    const match = query.match(/(?:^|\s)([a-z]*)$/i);
    if (!match) return [];
    const token = (match[1] ?? "").toLowerCase();
    return SEARCH_FIELDS.filter((field) => field.startsWith(token));
}

export function completeSearchField(query: string, field: string): string {
    return query.replace(/[a-z]*$/i, `${field}:`);
}

/** Match web dashboard search: free text plus name/tag/note filters. */
export function parseSearchQuery(query: string): ParsedSearchQuery {
    const parsed: ParsedSearchQuery = {
        nameTerms: [],
        tagTerms: [],
        noteTerms: [],
        freeText: query.trim(),
    };

    const identifierRegex =
        /(^|\s)(name|tag|note):((?:"[^"]*"|[^,\s]+)(?:\s*,\s*(?:"[^"]*"|[^,\s]+))*)/g;
    let remaining = query;

    remaining = remaining.replace(
        identifierRegex,
        (_fullMatch, leadingWhitespace, identifier, rawValue) => {
            const values = parseIdentifierValues(String(rawValue));
            if (identifier === "name") {
                parsed.nameTerms.push(...values);
            } else if (identifier === "tag") {
                parsed.tagTerms.push(...values);
            } else if (identifier === "note") {
                parsed.noteTerms.push(...values);
            }
            return String(leadingWhitespace ?? "");
        },
    );

    parsed.freeText = remaining
        .replace(/(^|\s)(name|tag|note):\s*$/i, "$1")
        .trim()
        .replace(/\s+/g, " ");
    return parsed;
}

export function filterCredentials(
    credentials: VaultCredential[],
    query: string,
    { includeURLs = false }: { includeURLs?: boolean } = {},
): VaultCredential[] {
    const parsed = parseSearchQuery(query);
    const hasIdentifierFilters =
        parsed.nameTerms.length > 0 ||
        parsed.tagTerms.length > 0 ||
        parsed.noteTerms.length > 0;
    const freeLower = parsed.freeText.toLowerCase();
    if (!hasIdentifierFilters && freeLower.length === 0) return credentials;

    return credentials.filter((credential) => {
        const tags = parseTags(credential.Tags);
        const searchableFields = [
            credential.Name,
            credential.Username,
            credential.Notes,
            ...(includeURLs ? [credential.URL, ...(credential.AdditionalURLs ?? []).map((rule) => rule.URL)] : []),
            credential.Passkey?.RPID ?? "",
            credential.Passkey?.UserName ?? "",
            credential.Passkey?.UserDisplayName ?? "",
            ...tags,
        ];

        const matchesFreeText =
            freeLower.length === 0
                ? true
                : searchableFields.some((field) =>
                      field.toLowerCase().includes(freeLower),
                  );

        if (!hasIdentifierFilters) return matchesFreeText;

        const matchesNames =
            parsed.nameTerms.length === 0
                ? true
                : parsed.nameTerms.some((nameTerm) =>
                      credential.Name.toLowerCase().includes(
                          nameTerm.toLowerCase(),
                      ),
                  );

        const matchesTags =
            parsed.tagTerms.length === 0
                ? true
                : parsed.tagTerms.some((tagTerm) =>
                      tags.some((tag) =>
                          tag.toLowerCase().includes(tagTerm.toLowerCase()),
                      ),
                  );

        const matchesNotes =
            parsed.noteTerms.length === 0
                ? true
                : parsed.noteTerms.some((noteTerm) =>
                      credential.Notes.toLowerCase().includes(
                          noteTerm.toLowerCase(),
                      ),
                  );

        return matchesNames && matchesTags && matchesNotes && matchesFreeText;
    });
}

// Reuse locale setup instead of rebuilding it for every sort comparison.
const nameCollator = new Intl.Collator(undefined, { sensitivity: "base" });

export function sortCredentials(
    credentials: VaultCredential[],
    sort: CredentialSort,
): VaultCredential[] {
    const sorted = [...credentials];
    sorted.sort((a, b) => {
        switch (sort) {
            case "name-asc":
                return (
                    nameCollator.compare(a.Name, b.Name) ||
                    a.ID.localeCompare(b.ID)
                );
            case "name-desc":
                return (
                    nameCollator.compare(b.Name, a.Name) ||
                    a.ID.localeCompare(b.ID)
                );
            case "modified-asc": {
                const aTs = a.DateModifiedTimestamp || a.DateCreatedTimestamp;
                const bTs = b.DateModifiedTimestamp || b.DateCreatedTimestamp;
                return aTs - bTs || a.ID.localeCompare(b.ID);
            }
            case "modified-desc":
            default: {
                const aTs = a.DateModifiedTimestamp || a.DateCreatedTimestamp;
                const bTs = b.DateModifiedTimestamp || b.DateCreatedTimestamp;
                return bTs - aTs || a.ID.localeCompare(b.ID);
            }
        }
    });
    return sorted;
}

export function joinTags(tags: string[]): string {
    return tags
        .map((t) => t.trim())
        .filter(Boolean)
        .join(CredentialConstants.TAG_SEPARATOR);
}

export function tagsToDisplay(tags?: string): string {
    return parseTags(tags).join(", ");
}
