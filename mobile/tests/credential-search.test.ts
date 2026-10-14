import { describe, expect, it } from "@jest/globals";

import {
    completeSearchField,
    searchFieldSuggestions,
    filterCredentials,
    parseSearchQuery,
    sortCredentials,
} from "@/utils/credential-search";
import { CredentialConstants } from "@cryptex-industries/vault-core/consts";
import { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";

function cred(
    partial: Partial<VaultCredential> & Pick<VaultCredential, "ID" | "Name">,
): VaultCredential {
    return Object.assign(new VaultCredential(), {
        Username: "",
        Password: "",
        URL: "",
        Notes: "",
        Tags: "",
        DateCreatedTimestamp: 0,
        DateModifiedTimestamp: 0,
        Deleted: false,
        ...partial,
    });
}

describe("credential search", () => {
    it("preserves locale ordering, ID tie-breaks, and the input array", () => {
        const items = [
            "Éclair",
            "alpha",
            "ALPHA",
            "éclair",
            "Örebro",
            "Zulu",
        ].map((Name, index) => cred({ ID: String(index), Name }));
        const original = [...items];
        for (const direction of ["name-asc", "name-desc"] as const) {
            const expected = [...items].sort(
                (a, b) =>
                    (direction === "name-asc"
                        ? a.Name.localeCompare(b.Name, undefined, {
                              sensitivity: "base",
                          })
                        : b.Name.localeCompare(a.Name, undefined, {
                              sensitivity: "base",
                          })) || a.ID.localeCompare(b.ID),
            );
            expect(sortCredentials(items, direction)).toEqual(expected);
        }
        expect(items).toEqual(original);
    });

    it("parses free text and tag/note identifiers", () => {
        expect(
            parseSearchQuery(
                'github name:git tag:work,personal note:"vpn key"',
            ),
        ).toEqual({
            freeText: "github",
            nameTerms: ["git"],
            tagTerms: ["work", "personal"],
            noteTerms: ["vpn key"],
        });
    });

    it("filters by free text, tags, and notes", () => {
        const sep = CredentialConstants.TAG_SEPARATOR;
        const items = [
            cred({
                ID: "1",
                Name: "GitHub",
                Username: "alice",
                Tags: `work${sep}dev`,
                Notes: "corp vpn key",
            }),
            cred({
                ID: "2",
                Name: "Bank",
                Username: "bob",
                Tags: "personal",
                Notes: "savings",
            }),
        ];

        expect(filterCredentials(items, "git").map((c) => c.ID)).toEqual(["1"]);
        expect(
            filterCredentials(items, "tag:personal").map((c) => c.ID),
        ).toEqual(["2"]);
        expect(filterCredentials(items, "note:vpn").map((c) => c.ID)).toEqual([
            "1",
        ]);
        expect(
            filterCredentials(items, "tag:work note:vpn").map((c) => c.ID),
        ).toEqual(["1"]);
        expect(filterCredentials(items, "name:bank").map((c) => c.ID)).toEqual([
            "2",
        ]);
    });

    it("suggests trailing field prefixes and preserves existing filters", () => {
        expect(searchFieldSuggestions("")).toEqual(["name", "tag", "note"]);
        expect(searchFieldSuggestions("N")).toEqual(["name", "note"]);
        expect(searchFieldSuggestions("tag:work na")).toEqual(["name"]);
        expect(searchFieldSuggestions("tag:work ")).toEqual(["name", "tag", "note"]);
        for (const query of ["tag:", "tag:na", "github", 'note:"na']) {
            expect(searchFieldSuggestions(query)).toEqual([]);
        }
        expect(completeSearchField("tag:work NA", "name")).toBe("tag:work name:");
        expect(completeSearchField("tag:work ", "note")).toBe("tag:work note:");
    });

    it("keeps results while a field prefix is incomplete, including after another filter", () => {
        const items = [cred({ ID: "1", Name: "Alpha", Tags: "work" }), cred({ ID: "2", Name: "Beta" })];
        for (const query of ["", "name:", "tag:", "NOTE: "]) {
            expect(filterCredentials(items, query)).toEqual(items);
        }
        expect(filterCredentials(items, "tag:work name:")).toEqual([items[0]]);
    });

    it("clears a search without inspecting or rebuilding unchanged credentials", () => {
        const item = cred({ ID: "1", Name: "Alpha" });
        Object.defineProperty(item, "Tags", {
            get: () => {
                throw new Error("Empty searches do not need credential fields");
            },
        });
        const items = [item];
        for (const query of ["", "   ", "name:", "tag:", "NOTE: "]) {
            expect(filterCredentials(items, query)).toBe(items);
        }
    });

    it("matches web free-text fields and combines quoted alternatives with other filters", () => {
        const items = [
            cred({ ID: "1", Name: "Alpha Team", Username: "alice", Tags: "work", Notes: "vpn key", URL: "https://only-url.example" }),
            cred({ ID: "2", Name: "Beta", Tags: "personal", Notes: "vpn key" }),
        ];
        expect(filterCredentials(items, 'name:"Alpha Team",Beta note:"vpn key"')).toEqual(items);
        expect(filterCredentials(items, 'name:"Alpha Team",Beta tag:work')).toEqual([items[0]]);
        expect(filterCredentials(items, "ALICE")).toEqual([items[0]]);
        expect(filterCredentials(items, "only-url.example")).toEqual([]);
        expect(filterCredentials(items, "only-url.example", { includeURLs: true })).toEqual([items[0]]);
    });

    it("sorts by name and modified timestamps", () => {
        const items = [
            cred({
                ID: "b",
                Name: "Beta",
                DateModifiedTimestamp: 20,
            }),
            cred({
                ID: "a",
                Name: "Alpha",
                DateModifiedTimestamp: 10,
            }),
        ];

        expect(sortCredentials(items, "name-asc").map((c) => c.ID)).toEqual([
            "a",
            "b",
        ]);
        expect(sortCredentials(items, "name-desc").map((c) => c.ID)).toEqual([
            "b",
            "a",
        ]);
        expect(
            sortCredentials(items, "modified-desc").map((c) => c.ID),
        ).toEqual(["b", "a"]);
        expect(sortCredentials(items, "modified-asc").map((c) => c.ID)).toEqual(
            ["a", "b"],
        );
    });
});
