import { describe, expect, it } from "@jest/globals";

import {
    CredentialURLMatchMode,
    CustomFieldType,
} from "@cryptex-industries/vault-core/proto";
import {
    updateCredentialFromForm,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    autofillAssociationWarning,
    autofillEmail,
    appendAutofillAssociation,
    buildAutofillCredentialRows,
    buildAutofillTarget,
    canAssociateAutofillTarget,
    defaultAutofillCredentialName,
    isAutofillGetRequest,
    isAutofillSaveRequest,
    matchingAutofillCredentials,
    requiresAutofillReview,
} from "@/utils/android-autofill";

const credential = (
    id: string,
    url: string,
    mode: CredentialURLMatchMode = CredentialURLMatchMode.ExactHost,
) =>
    Object.assign(new VaultCredential(), {
        ID: id,
        Name: id,
        Username: `${id}@example.test`,
        Password: "secret",
        URL: url,
        URLMatchMode: mode,
        Deleted: false,
    });

describe("Android autofill matching", () => {
    it("requires a separate review before browser accessibility filling", () => {
        const website = {
            pageUrl: "https://example.test",
            appUri: null,
            displayName: "example.test",
            warningType: null,
        } as const;
        expect(requiresAutofillReview(website, "accessibility-get", true)).toBe(true);
        expect(requiresAutofillReview(website, "autofill-get", true)).toBe(false);
        expect(requiresAutofillReview(website, "autofill-get", false)).toBe(true);
    });

    it("does not match a saved HTTPS login when the browser hides the scheme", () => {
        const target = buildAutofillTarget({
            id: "scheme-hidden",
            kind: "accessibility-get",
            packageName: "com.android.chrome",
            webDomain: "example.test",
            webScheme: "unknown",
        });
        expect(target.pageUrl).toBe("http://example.test");
        expect(target.warningType).toBe("unverified-web-scheme");
        expect(target.appUri).toBeNull();
        expect(matchingAutofillCredentials([credential("secure", "https://example.test")], target)).toEqual([]);
        expect(autofillAssociationWarning(target)).toContain("Browser connection type is unknown");
        expect(canAssociateAutofillTarget(target)).toBe(false);
        expect(requiresAutofillReview(target, "accessibility-get", false)).toBe(true);
    });

    it("requires review when Android cannot identify the receiving field's website", () => {
        const target = buildAutofillTarget({
            id: "field-origin-hidden",
            kind: "autofill-get",
            packageName: "com.android.chrome",
            webDomain: "example.test",
            webScheme: "https",
            warningType: "unverified-field-origin",
        });
        const item = credential("login", "https://example.test");

        expect(matchingAutofillCredentials([item], target)).toEqual([item]);
        expect(autofillAssociationWarning(target)).toContain("could not confirm");
        expect(requiresAutofillReview(target, "autofill-get", true)).toBe(true);
        expect(canAssociateAutofillTarget(target)).toBe(false);
    });

    it("routes framework and accessibility requests through the shared autofill policy", () => {
        expect(
            isAutofillGetRequest({
                id: "framework-get",
                kind: "autofill-get",
            }),
        ).toBe(true);
        expect(
            isAutofillGetRequest({
                id: "accessibility-get",
                kind: "accessibility-get",
            }),
        ).toBe(true);
        expect(
            isAutofillSaveRequest({
                id: "accessibility-save",
                kind: "accessibility-save",
            }),
        ).toBe(true);
        expect(
            isAutofillSaveRequest({
                id: "provider-get",
                kind: "provider-password-get",
            }),
        ).toBe(false);
    });

    it("names browser saves after the website instead of the browser", () => {
        expect(
            defaultAutofillCredentialName({
                id: "request",
                kind: "autofill-save",
                packageName: "com.android.chrome",
                applicationLabel: "Browser",
                webDomain: "accounts.example.test",
            }),
        ).toBe("accounts.example.test");
    });

    it("uses the application label when a native app has no website", () => {
        expect(
            defaultAutofillCredentialName({
                id: "request",
                kind: "autofill-save",
                packageName: "com.example.mobile",
                applicationLabel: "Example App",
            }),
        ).toBe("Example App");
    });

    it("reads a saved email independently of the login username", () => {
        const item = credential("separate-fields", "https://example.test");
        item.Username = "account-name";
        item.CustomFields = [
            {
                ID: "email-field",
                Name: "Email",
                Type: CustomFieldType.Text,
                Value: "person@example.test",
            },
        ];

        expect(autofillEmail(item)).toBe("person@example.test");
        expect(item.Username).toBe("account-name");
    });

    it("uses the exact reported browser host and existing URI match mode", () => {
        const target = buildAutofillTarget({
            id: "request",
            kind: "autofill-get",
            packageName: "com.android.chrome",
            webDomain: "login.example.test",
            webScheme: "https",
        });
        const items = [
            credential("exact", "https://login.example.test"),
            credential("wrong-exact", "https://example.test"),
            credential(
                "domain",
                "https://example.test",
                CredentialURLMatchMode.Domain,
            ),
        ];

        expect(
            matchingAutofillCredentials(items, target).map((item) => item.ID),
        ).toEqual(["exact", "domain"]);
        expect(target.appUri).toBeNull();
    });

    it("never treats a browser package association as a website match", () => {
        const target = buildAutofillTarget({
            id: "request",
            kind: "autofill-get",
            packageName: "com.android.chrome",
            webDomain: "unrelated.example.test",
            webScheme: "https",
        });
        const browserAssociation = credential(
            "browser",
            "androidapp://com.android.chrome",
        );

        expect(
            matchingAutofillCredentials([browserAssociation], target),
        ).toEqual([]);
    });

    it("matches native application associations without crossing package boundaries", () => {
        const target = buildAutofillTarget({
            id: "request",
            kind: "autofill-get",
            packageName: "com.example.mobile",
            applicationLabel: "Example",
            warningType: "unverified-app",
        });
        const items = [
            Object.assign(credential("app", "https://example.test"), {
                AdditionalURLs: [
                    {
                        URL: "androidapp://com.example.mobile",
                        MatchMode: CredentialURLMatchMode.ExactHost,
                    },
                ],
            }),
            credential("lookalike", "androidapp://com.example.mobile.fake"),
        ];

        expect(
            matchingAutofillCredentials(items, target).map((item) => item.ID),
        ).toEqual(["app"]);
        expect(autofillAssociationWarning(target)).toContain(
            "Cryptex Vault could not check",
        );
        expect(target.appUri).toBe("androidapp://com.example.mobile");
    });

    it("keeps the website when remembering an app as an additional target", async () => {
        const existing = credential("app", "https://example.test");
        const saved = await updateCredentialFromForm(existing, {
            ...existing,
            AdditionalURLs: [
                {
                    URL: "androidapp://com.example.mobile",
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ],
        });

        expect(saved.URL).toBe("https://example.test");
        expect(saved.AdditionalURLs).toEqual([
            {
                URL: "androidapp://com.example.mobile",
                MatchMode: CredentialURLMatchMode.ExactHost,
            },
        ]);
    });

    it("keeps matches first and searches the entire unified list", () => {
        const items = [
            credential("match-two", "https://example.test"),
            credential("zulu", "https://zulu.test"),
            credential("match-one", "https://example.test"),
            credential("alpha", "https://alpha.test"),
        ];
        const matches = [items[0]!, items[2]!];

        expect(
            buildAutofillCredentialRows(items, matches, "", false).map(
                (row) => [row.credential.ID, row.isMatch],
            ),
        ).toEqual([
            ["match-one", true],
            ["match-two", true],
        ]);
        expect(
            buildAutofillCredentialRows(items, matches, "", true).map(
                (row) => row.credential.ID,
            ),
        ).toEqual(["match-one", "match-two", "alpha", "zulu"]);
        expect(
            buildAutofillCredentialRows(items, matches, "zulu", false).map(
                (row) => row.credential.ID,
            ),
        ).toEqual(["zulu"]);
    });

    it("adds an exact association once without replacing saved targets", () => {
        const item = credential("login", "https://saved.example.test");
        item.AdditionalURLs = [
            {
                URL: "https://other.example.test",
                MatchMode: CredentialURLMatchMode.Domain,
            },
        ];

        expect(
            appendAutofillAssociation(
                item,
                "https://accounts.example.test",
            ),
        ).toEqual([
            ...item.AdditionalURLs,
            {
                URL: "https://accounts.example.test",
                MatchMode: CredentialURLMatchMode.ExactHost,
            },
        ]);
        expect(
            appendAutofillAssociation(item, "https://other.example.test"),
        ).toBe(item.AdditionalURLs);
    });

    it("only offers association for safe supported targets", () => {
        expect(
            canAssociateAutofillTarget(
                buildAutofillTarget({
                    id: "web",
                    kind: "autofill-get",
                    webDomain: "example.test",
                    webScheme: "https",
                }),
            ),
        ).toBe(true);
        expect(
            canAssociateAutofillTarget(
                buildAutofillTarget({
                    id: "http",
                    kind: "autofill-get",
                    webDomain: "example.test",
                    webScheme: "http",
                }),
            ),
        ).toBe(false);
        expect(
            canAssociateAutofillTarget(
                buildAutofillTarget({
                    id: "app",
                    kind: "autofill-get",
                    packageName: "com.example.app",
                    warningType: "unverified-app",
                }),
            ),
        ).toBe(true);
        expect(
            canAssociateAutofillTarget(
                buildAutofillTarget({
                    id: "embedded",
                    kind: "autofill-get",
                    webDomain: "example.test",
                    warningType: "untrusted-web-context",
                }),
            ),
        ).toBe(false);
    });

    it("requires confirmation for an embedded cross-site login form", () => {
        const target = buildAutofillTarget({
            id: "request",
            kind: "autofill-get",
            webDomain: "accounts.example.test",
            webScheme: "https",
            warningType: "untrusted-web-context",
        });

        expect(requiresAutofillReview(target, "autofill-get", true)).toBe(true);
        expect(autofillAssociationWarning(target)).toContain("embedded");
    });

    it("does not offer deleted or passwordless items", () => {
        const target = buildAutofillTarget({
            id: "request",
            kind: "autofill-get",
            webDomain: "example.test",
        });
        const deleted = credential("deleted", "https://example.test");
        deleted.Deleted = true;
        const passwordless = credential("passwordless", "https://example.test");
        passwordless.Password = "";

        expect(
            matchingAutofillCredentials([deleted, passwordless], target),
        ).toEqual([]);
    });
});
