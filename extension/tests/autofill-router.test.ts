/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";

import {
    handleGenerateTOTP,
    handleGetCredentialSecret,
    matchCredentialsForOrigin,
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

const requestOrigin = (
    host: string,
    etldPlus1 = "example.com",
): AutofillRequestOrigin => ({
    host,
    etldPlus1,
});

describe("autofill origin matching", () => {
    it("returns only exact host matches by default", () => {
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
            { host: "login.example.com" },
        );

        expect(result.exact.map((c) => c.id)).toEqual(["cred_1"]);
        expect(result.fuzzy).toEqual([]);
    });

    it("normalizes case and trailing dots for exact host matches", () => {
        const result = matchCredentialsForOrigin(
            [
                credential({
                    URL: "https://Login.Example.Com.",
                }),
            ],
            { host: "login.example.com." },
        );

        expect(result.exact.map((c) => c.id)).toEqual(["cred_1"]);
        expect(result.fuzzy).toEqual([]);
    });

    it("does not release password material to sibling subdomains", async () => {
        const result = await handleGetCredentialSecret(
            { id: "cred_1" },
            { Credentials: [credential()] } as never,
            requestOrigin("evil.example.com"),
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
            requestOrigin("evil.example.com"),
        );

        expect(result).toEqual({ ok: false, error: "ORIGIN_MISMATCH" });
    });
});
