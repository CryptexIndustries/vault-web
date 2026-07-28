import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CredentialConstants } from "@/utils/consts";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";

const FIELDS = ["name", "tag", "note"] as const;
type Field = (typeof FIELDS)[number];

export function parseTags(tags?: string): string[] {
    if (!tags) return [];
    return tags
        .split(CredentialConstants.TAG_SEPARATOR)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function parseSearchQuery(query: string) {
    const terms: Record<Field, string[]> = { name: [], tag: [], note: [] };

    const remaining = query.replace(
        /(^|\s)(name|tag|note):((?:"[^"]*"|[^,\s]+)(?:\s*,\s*(?:"[^"]*"|[^,\s]+))*)/g,
        (_match, whitespace: string, field: Field, raw: string) => {
            for (const part of raw.matchAll(/"([^"]*)"|([^,]+)/g)) {
                const value = (part[1] ?? part[2] ?? "").trim();
                if (value) terms[field].push(value);
            }
            return whitespace;
        },
    );

    // Drop bare trailing prefixes (e.g. `name:`) so they don't filter as free text.
    const freeText = remaining
        .replace(/(^|\s)(name|tag|note):\s*$/i, "$1")
        .trim()
        .replace(/\s+/g, " ");

    return { terms, freeText };
}

function includesCI(haystack: string, needle: string) {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesAny(terms: string[], values: string[]) {
    return (
        terms.length === 0 ||
        terms.some((term) => values.some((value) => includesCI(value, term)))
    );
}

export function credentialMatchesSearch(
    credential: VaultCredential,
    query: string,
): boolean {
    const { terms, freeText } = parseSearchQuery(query);
    const tags = parseTags(credential.Tags);

    const freeOk =
        !freeText ||
        [credential.Name, credential.Username, credential.Notes, ...tags].some(
            (value) => includesCI(value, freeText),
        );

    return (
        freeOk &&
        matchesAny(terms.name, [credential.Name]) &&
        matchesAny(terms.tag, tags) &&
        matchesAny(terms.note, [credential.Notes])
    );
}

/** Trailing word-boundary token that can complete to name:/tag:/note:. */
function autocompleteToken(query: string): string | null {
    const match = query.match(/(?:^|\s)([a-z]*)$/i);
    if (!match) return null;

    const token = match[1] ?? "";
    if (!token) return query === "" || /\s$/.test(query) ? "" : null;

    const lower = token.toLowerCase();
    return FIELDS.some((field) => field.startsWith(lower)) ? token : null;
}

type CredentialSearchProps = {
    value: string;
    onChange: (value: string) => void;
    focusRequestToken?: number;
    className?: string;
};

export function CredentialSearch({
    value,
    onChange,
    focusRequestToken = 0,
    className,
}: CredentialSearchProps) {
    const listId = useId();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [focused, setFocused] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);

    const token = focused && !dismissed ? autocompleteToken(value) : null;
    const suggestions =
        token === null
            ? []
            : FIELDS.filter(
                  (field) =>
                      token === "" || field.startsWith(token.toLowerCase()),
              );
    const open = suggestions.length > 0;
    const activeIndex = open ? Math.min(active, suggestions.length - 1) : 0;
    const activeOptionId = open
        ? `${listId}-${suggestions[activeIndex]}`
        : undefined;

    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, [focusRequestToken]);

    const applyField = (field: Field) => {
        const next = `${value.slice(0, value.length - (token?.length ?? 0))}${field}:`;
        onChange(next);
        setDismissed(true);
        requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(next.length, next.length);
        });
    };

    return (
        <div className={cn("relative min-w-0 flex-1", className)}>
            <Search
                className="pointer-events-none absolute left-2 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
            />
            <Input
                ref={inputRef}
                role="combobox"
                aria-label="Search credentials"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={activeOptionId}
                aria-haspopup="listbox"
                placeholder="Search… try name: tag: or note:"
                value={value}
                autoComplete="off"
                spellCheck={false}
                className="bg-card pl-9 text-sm"
                onChange={(event) => {
                    setDismissed(false);
                    setActive(0);
                    onChange(event.target.value);
                }}
                onFocus={() => {
                    setFocused(true);
                    setDismissed(false);
                }}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => {
                    if (open) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActive((i) => (i + 1) % suggestions.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActive(
                                (i) =>
                                    (i - 1 + suggestions.length) %
                                    suggestions.length,
                            );
                            return;
                        }
                        if (event.key === "Tab" || event.key === "Enter") {
                            event.preventDefault();
                            applyField(suggestions[activeIndex]!);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            setDismissed(true);
                            return;
                        }
                    }

                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.blur();
                    }
                }}
            />
            <div
                id={listId}
                role="listbox"
                aria-label="Search fields"
                hidden={!open}
                className="absolute inset-x-0 top-full z-50 mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
                {suggestions.map((field, index) => (
                    <div
                        key={field}
                        id={`${listId}-${field}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        className={cn(
                            "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
                            index === activeIndex
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-accent/60",
                        )}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            applyField(field);
                        }}
                        onMouseEnter={() => setActive(index)}
                    >
                        <span className="font-medium">{field}:</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
