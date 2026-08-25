/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";

import {
    handleGenerateTOTP,
    handleGetCredentialSecret,
    matchCredentialsForOrigin,
    toLiteCredential,
    toSearchableLiteCredential,
    type AutofillRequestOrigin,
} from "../src/background/autofill-router";

const credential = (overrides: Record<string, unknown> = {}) =>
    ({
        ID: "cred_1",
        Name: "Example",
        Username: "user@example.com",
        Password: "secret",
        URL: "https://login.example.com",
        Deleted: false,
        ...overrides,
    }) as never;

const requestOrigin = (url: string): AutofillRequestOrigin => {
    const parsed = new URL(url);
    return {
        url: parsed.href,
        host: parsed.hostname,
    };
};

describe("autofill origin matching", () => {
    it("includes TOTP availability independently of the password", () => {
        const lite = toLiteCredential(
            credential({
                Password: "also-has-a-password",
                TOTP: {
                    Secret: "JBSWY3DPEHPK3PXP",
                    Algorithm: 1,
                    Digits: 6,
                    Period: 30,
                },
            }),
        );

        expect(lite.hasTOTP).toBe(true);
    });

    it("projects passkey labels without exposing key material", () => {
        const lite = toLiteCredential(
            credential({
                Type: ItemType.Passkey,
                Passkey: {
                    RPID: "example.com",
                    UserName: "person@example.com",
                    UserDisplayName: "Person",
                    CredentialID: "credential-id",
                    PrivateKey: "private-jwk",
                },
            }),
        );

        expect(lite).toMatchObject({
            type: ItemType.Passkey,
            passkey: {
                RPID: "example.com",
                UserName: "person@example.com",
                UserDisplayName: "Person",
            },
        });
        expect(JSON.stringify(lite)).not.toContain("private-jwk");
        expect(JSON.stringify(lite)).not.toContain("credential-id");
    });

    it("only includes tags and notes in the privileged searchable projection", () => {
        const source = credential({
            Tags: "work,|.|,admin",
            Notes: "Recovery contact is Alice",
        });

        expect(toLiteCredential(source)).not.toMatchObject({
            tags: expect.anything(),
            notes: expect.anything(),
        });
        expect(toSearchableLiteCredential(source)).toMatchObject({
            tags: "work,|.|,admin",
            notes: "Recovery contact is Alice",
        });
    });

    it("returns only credentials authorized for the page URL", () => {
        const result = matchCredentialsForOrigin(
            [
                credential(),
                credential({
                    ID: "cred_2",
                    URL: "https://evil.example.com",
                }),
                credential({
                    ID: "cred_3",
                    URL: "https://example.co.uk",
                }),
            ],
            { url: "https://login.example.com" },
        );

        expect(result.map((item) => item.id)).toEqual(["cred_1"]);
    });

    it("normalizes case and trailing dots for exact host matches", () => {
        const result = matchCredentialsForOrigin(
            [
                credential({
                    URL: "https://Login.Example.Com.",
                }),
            ],
            { url: "https://login.example.com." },
        );

        expect(result.map((item) => item.id)).toEqual(["cred_1"]);
    });

    it("does not release password material to sibling subdomains", async () => {
        const result = await handleGetCredentialSecret(
            { id: "cred_1" },
            { Credentials: [credential()] } as never,
            requestOrigin("https://evil.example.com"),
        );

        expect(result).toEqual({ ok: false, error: "ORIGIN_MISMATCH" });
    });

    it("does not generate TOTP for sibling subdomains", async () => {
        const result = await handleGenerateTOTP(
            { id: "cred_1" },
            {
                Credentials: [
                    credential({
                        TOTP: {
                            Secret: "JBSWY3DPEHPK3PXP",
                            Algorithm: 1,
                            Digits: 6,
                            Period: 30,
                        },
                    }),
                ],
            } as never,
            requestOrigin("https://evil.example.com"),
        );

        expect(result).toEqual({ ok: false, error: "ORIGIN_MISMATCH" });
    });

    it("matches an additional credential URL", () => {
        const result = matchCredentialsForOrigin(
            [
                credential({
                    AdditionalURLs: [
                        {
                            URL: "https://accounts.example.net",
                            MatchMode: CredentialURLMatchMode.ExactHost,
                        },
                    ],
                }),
            ],
            { url: "https://accounts.example.net/login" },
        );

        expect(result.map((item) => item.id)).toEqual(["cred_1"]);
        expect(result[0]?.url).toBe("https://accounts.example.net");
    });

    it("releases a credential authorized by domain mode", async () => {
        const result = await handleGetCredentialSecret(
            { id: "cred_1" },
            {
                Credentials: [
                    credential({
                        URL: "https://www.example.com/en",
                        URLMatchMode: CredentialURLMatchMode.Domain,
                    }),
                ],
            } as never,
            requestOrigin("https://app.example.com/"),
        );

        expect(result).toMatchObject({
            ok: true,
            username: "user@example.com",
            password: "secret",
        });
    });
});
