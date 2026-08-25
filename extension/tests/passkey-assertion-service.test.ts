/** @jest-environment node */
import { beforeEach, describe, expect, it } from "@jest/globals";

import type * as VaultTypes from "@cryptex-industries/vault-core/proto";

import {
    beginPasskeyAssertion,
    completePasskeyAssertion,
    resolveValidRpId,
} from "../src/background/passkey-assertion-service";

let sessionValues: Record<string, unknown>;

beforeEach(() => {
    sessionValues = {};
    Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: {
            storage: {
                session: {
                    get: async (key: string | string[] | null) => {
                        if (key === null) return { ...sessionValues };
                        const keys = Array.isArray(key) ? key : [key];
                        return Object.fromEntries(
                            keys
                                .filter(
                                    (candidate) => candidate in sessionValues,
                                )
                                .map((candidate) => [
                                    candidate,
                                    sessionValues[candidate],
                                ]),
                        );
                    },
                    set: async (values: Record<string, unknown>) => {
                        Object.assign(sessionValues, values);
                    },
                    remove: async (key: string | string[]) => {
                        for (const candidate of Array.isArray(key)
                            ? key
                            : [key]) {
                            delete sessionValues[candidate];
                        }
                    },
                },
            },
        },
    });
});

const origin = (url: string) => {
    const parsed = new URL(url);
    return { url, host: parsed.hostname, protocol: parsed.protocol };
};

describe("passkey assertion RP ID validation", () => {
    it("accepts the effective host and a registrable parent domain", () => {
        expect(
            resolveValidRpId(origin("https://accounts.google.com/login")),
        ).toBe("accounts.google.com");
        expect(
            resolveValidRpId(
                origin("https://accounts.google.com/login"),
                "google.com",
            ),
        ).toBe("google.com");
    });

    it("rejects unrelated domains and public suffixes", () => {
        expect(
            resolveValidRpId(
                origin("https://accounts.google.com"),
                "example.com",
            ),
        ).toBeNull();
        expect(
            resolveValidRpId(origin("https://accounts.google.com"), "com"),
        ).toBeNull();
    });

    it("only accepts loopback hosts as exact RP IDs", () => {
        expect(resolveValidRpId(origin("http://127.0.0.1:4173"))).toBe(
            "127.0.0.1",
        );
        expect(
            resolveValidRpId(origin("http://sub.localhost:4173"), "localhost"),
        ).toBeNull();
    });

    it("rejects WebAuthn on an insecure non-loopback origin", () => {
        expect(resolveValidRpId(origin("http://example.com"))).toBeNull();
    });
});

describe("passkey assertion request bounds", () => {
    const request = (ids: string[]) => ({
        publicKey: {
            challenge: "Y2hhbGxlbmdl",
            rpId: "example.com",
            allowCredentials: ids.map((id) => ({
                type: "public-key" as const,
                id,
            })),
            userVerification: "required" as const,
        },
    });

    it("rejects oversized allow lists before touching vault state", async () => {
        const response = await beginPasskeyAssertion(
            request(Array.from({ length: 257 }, () => "Y3JlZGVudGlhbA")),
            null,
            null,
            origin("https://example.com"),
            {} as chrome.runtime.MessageSender,
        );
        expect(response).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    });

    it("rejects malformed base64url credential IDs", async () => {
        const response = await beginPasskeyAssertion(
            request(["not+base64"]),
            null,
            null,
            origin("https://example.com"),
            {} as chrome.runtime.MessageSender,
        );
        expect(response).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    });
});

describe("passkey assertion ceremony binding", () => {
    const originalCredentialId = "Y3JlZGVudGlhbA";
    const sender = {
        tab: { id: 7 },
        frameId: 0,
        documentId: "document-1",
    } as chrome.runtime.MessageSender;
    const passkey = {
        CredentialID: originalCredentialId,
        RPID: "example.com",
        UserName: "person@example.com",
        UserDisplayName: "Person",
        Discoverable: true,
    } as VaultTypes.PasskeyData;
    const credential = {
        ID: "vault-credential-1",
        Name: "Example",
        Deleted: false,
        Passkey: passkey,
    } as VaultTypes.Credential;
    const vault = { Credentials: [credential] } as VaultTypes.Vault;
    const request = {
        publicKey: {
            challenge: "Y2hhbGxlbmdl",
            rpId: "example.com",
            allowCredentials: [],
            userVerification: "discouraged" as const,
        },
    };

    it("keeps a second site from replacing an open confirmation", async () => {
        const first = await beginPasskeyAssertion(
            request,
            vault,
            1,
            origin("https://example.com"),
            sender,
        );
        const second = await beginPasskeyAssertion(
            request,
            vault,
            1,
            origin("https://example.com"),
            sender,
        );
        expect(first.ok && first.ceremonyId).toBeTruthy();
        expect(second).toEqual({
            ok: false,
            error: "PASSKEY_CONFIRMATION_BUSY",
        });
        expect(Object.keys(sessionValues)).toHaveLength(2);
    });

    it("rejects a passkey swapped after candidate selection", async () => {
        const begun = await beginPasskeyAssertion(
            request,
            vault,
            1,
            origin("https://example.com"),
            sender,
        );
        if (!begun.ok || !begun.ceremonyId) throw new Error("begin failed");
        credential.Passkey!.CredentialID = "c3dhcHBlZA";
        const completed = await completePasskeyAssertion(
            {
                ceremonyId: begun.ceremonyId,
                credentialId: credential.ID,
            },
            vault,
            { DBIndex: 1 } as VaultTypes.VaultMetadata,
        );
        expect(completed).toEqual({ ok: false, error: "CREDENTIAL_CHANGED" });
        credential.Passkey!.CredentialID = originalCredentialId;
    });
});
