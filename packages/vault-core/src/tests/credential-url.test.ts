import { describe, expect, it } from "@jest/globals";

import { CredentialURLMatchMode } from "../proto/vault";
import {
    credentialMatchesPageUrl,
    findCredentialUrlMatch,
    isCredentialUrlRuleValid,
    sanitizeAdditionalCredentialUrls,
} from "../credential-url";

const credential = {
    URL: "https://login.example.com",
    URLMatchMode: CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [
        {
            URL: "https://accounts.example.net",
            MatchMode: CredentialURLMatchMode.ExactHost,
        },
    ],
};

describe("credential URL matching", () => {
    it("matches the primary or any additional exact host", () => {
        expect(
            credentialMatchesPageUrl(
                credential,
                "https://login.example.com/account",
            ),
        ).toBe(true);
        expect(
            findCredentialUrlMatch(
                credential,
                "https://accounts.example.net/sign-in",
            )?.rule.URL,
        ).toBe("https://accounts.example.net");
    });

    it("keeps parent and sibling hosts separate in exact mode", () => {
        expect(
            credentialMatchesPageUrl(credential, "https://example.com"),
        ).toBe(false);
        expect(
            credentialMatchesPageUrl(credential, "https://evil.example.com"),
        ).toBe(false);
    });

    it("matches parent and sibling hosts in domain mode", () => {
        const domainCredential = {
            URL: "https://www.example.com/en",
            URLMatchMode: CredentialURLMatchMode.Domain,
        };
        expect(
            credentialMatchesPageUrl(
                domainCredential,
                "https://app.example.com/",
            ),
        ).toBe(true);
        expect(
            credentialMatchesPageUrl(domainCredential, "https://example.net/"),
        ).toBe(false);
    });

    it("does not cross tenant boundaries on private suffixes", () => {
        expect(
            credentialMatchesPageUrl(
                {
                    URL: "https://alice.github.io",
                    URLMatchMode: CredentialURLMatchMode.Domain,
                },
                "https://bob.github.io",
            ),
        ).toBe(false);
    });

    it("matches safe hostname and path wildcards", () => {
        const wildcardCredential = {
            URL: "https://*.example.com/login/**",
            URLMatchMode: CredentialURLMatchMode.Wildcard,
        };
        expect(
            credentialMatchesPageUrl(
                wildcardCredential,
                "https://app.example.com/login/team/member",
            ),
        ).toBe(true);
        expect(
            credentialMatchesPageUrl(
                wildcardCredential,
                "https://example.com/login/team/member",
            ),
        ).toBe(false);
        expect(
            credentialMatchesPageUrl(
                wildcardCredential,
                "https://evil.com/example.com/login/team/member",
            ),
        ).toBe(false);
    });

    it("rejects wildcards in the registrable domain", () => {
        expect(
            isCredentialUrlRuleValid({
                URL: "https://*.com",
                MatchMode: CredentialURLMatchMode.Wildcard,
            }),
        ).toBe(false);
        expect(
            isCredentialUrlRuleValid({
                URL: "https://*.example.com",
                MatchMode: CredentialURLMatchMode.Wildcard,
            }),
        ).toBe(true);
    });

    it("prefers an exact rule over a domain rule", () => {
        const match = findCredentialUrlMatch(
            {
                URL: "https://example.com",
                URLMatchMode: CredentialURLMatchMode.Domain,
                AdditionalURLs: [
                    {
                        URL: "https://login.example.com",
                        MatchMode: CredentialURLMatchMode.ExactHost,
                    },
                ],
            },
            "https://login.example.com",
        );
        expect(match?.priority).toBe(3);
        expect(match?.rule.URL).toBe("https://login.example.com");
    });

    it("blocks an HTTPS credential on HTTP", () => {
        expect(
            credentialMatchesPageUrl(credential, "http://login.example.com"),
        ).toBe(false);
    });

    it("allows an HTTP credential to upgrade to HTTPS", () => {
        expect(
            credentialMatchesPageUrl(
                { URL: "http://login.example.com" },
                "https://login.example.com",
            ),
        ).toBe(true);
    });

    it("requires explicit non-default ports to match", () => {
        expect(
            credentialMatchesPageUrl(
                { URL: "https://login.example.com:8443" },
                "https://login.example.com:9443",
            ),
        ).toBe(false);
        expect(
            credentialMatchesPageUrl(
                { URL: "https://login.example.com:8443" },
                "https://login.example.com:8443/path",
            ),
        ).toBe(true);
    });

    it("normalizes legacy string URLs into exact-host rules", () => {
        expect(
            credentialMatchesPageUrl(
                { URL: "https://Login.Example.Com." },
                "https://login.example.com",
            ),
        ).toBe(true);
        expect(
            sanitizeAdditionalCredentialUrls(
                {
                    URL: "example.com",
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
                [
                    " https://example.com ",
                    "accounts.example.com",
                    "https://accounts.example.com/",
                    "javascript:alert(1)",
                ],
            ),
        ).toEqual([
            {
                URL: "accounts.example.com",
                MatchMode: CredentialURLMatchMode.ExactHost,
            },
        ]);
    });
});
