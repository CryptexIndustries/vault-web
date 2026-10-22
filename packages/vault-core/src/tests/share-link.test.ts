/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import * as OTPAuth from "otpauth";
import * as VaultUtilTypes from "../proto/vault";
import { uint8ToBase64Url } from "../encoding";
import {
    deriveShareKeys,
    deriveSharePeekToken,
    formatShareLink,
    generateShareSecret,
    hashShareToken,
    openSharePayload,
    parseShareLink,
    sealSharePayload,
    shareCiphertextNeedsPassphrase,
    shareExpiryOptions,
    defaultShareExpiry,
    type SharePayload,
} from "../vault-utils/share-link";
import {
    buildCredentialSharePayload,
    buildTextSharePayload,
    defaultCredentialShareSelection,
} from "../vault-utils/share-payload";

const payload: SharePayload = {
    v: 1,
    title: "Router admin",
    fields: [
        { label: "Username", value: "admin", kind: "text" },
        { label: "Password", value: "correct horse ✓", kind: "secret" },
    ],
};

const credential = {
    Name: "Mail",
    Username: "ana@example.com",
    Password: "s3cret",
    URL: "https://mail.example.com",
    AdditionalURLs: [
        {
            URL: "https://webmail.example.com",
            MatchMode: VaultUtilTypes.CredentialURLMatchMode.Domain,
        },
    ],
    Notes: "Shared inbox",
    TOTP: {
        Label: "Mail:ana",
        Secret: "JBSWY3DPEHPK3PXP",
        Period: 30,
        Digits: 6,
        Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
    },
    CustomFields: [
        {
            ID: "pin",
            Name: "PIN",
            Type: VaultUtilTypes.CustomFieldType.MaskedText,
            Value: "1234",
        },
        {
            ID: "dept",
            Name: "Department",
            Type: VaultUtilTypes.CustomFieldType.Text,
            Value: "Ops",
        },
    ],
};

describe("share envelope", () => {
    it("round-trips a payload without a passphrase", async () => {
        const secret = generateShareSecret();
        const sealed = await sealSharePayload(payload, secret);

        expect(sealed.ciphertext[0]).toBe(1);
        expect(shareCiphertextNeedsPassphrase(sealed.ciphertext)).toBe(false);
        await expect(
            openSharePayload(sealed.ciphertext, secret),
        ).resolves.toEqual(payload);
    });

    it("hashes the tokens the recipient will present", async () => {
        const secret = generateShareSecret();
        const sealed = await sealSharePayload(payload, secret);
        const keys = await deriveShareKeys(secret);

        expect(sealed.peekTokenHash).toEqual(hashShareToken(keys.peekToken));
        expect(sealed.revealTokenHash).toEqual(
            hashShareToken(keys.revealToken),
        );
        expect(deriveSharePeekToken(secret)).toEqual(keys.peekToken);
        expect(keys.peekToken).not.toEqual(keys.revealToken);
    });

    it("fails with another secret", async () => {
        const sealed = await sealSharePayload(payload, generateShareSecret());

        await expect(
            openSharePayload(sealed.ciphertext, generateShareSecret()),
        ).rejects.toThrow("SHARE_DECRYPT_FAILED");
    });

    it("rejects a tampered header", async () => {
        const secret = generateShareSecret();
        const sealed = await sealSharePayload(payload, secret);
        const tampered = new Uint8Array(sealed.ciphertext);
        tampered[1] = 0b10;

        await expect(openSharePayload(tampered, secret)).rejects.toThrow(
            "SHARE_DECRYPT_FAILED",
        );
        tampered[0] = 2;
        await expect(openSharePayload(tampered, secret)).rejects.toThrow(
            "SHARE_ENVELOPE_UNSUPPORTED",
        );
    });

    it("needs the passphrase when one is set", async () => {
        const secret = generateShareSecret();
        const sealed = await sealSharePayload(payload, secret, "blue lamp");

        expect(shareCiphertextNeedsPassphrase(sealed.ciphertext)).toBe(true);
        await expect(
            openSharePayload(sealed.ciphertext, secret, "blue lamp"),
        ).resolves.toEqual(payload);
        await expect(
            openSharePayload(sealed.ciphertext, secret, "red lamp"),
        ).rejects.toThrow("SHARE_DECRYPT_FAILED");
        await expect(
            openSharePayload(sealed.ciphertext, secret),
        ).rejects.toThrow("SHARE_DECRYPT_FAILED");
    });

    it("ties the reveal token to the passphrase but not the peek token", async () => {
        const secret = generateShareSecret();
        const right = await deriveShareKeys(secret, "blue lamp");
        const wrong = await deriveShareKeys(secret, "red lamp");

        expect(right.peekToken).toEqual(wrong.peekToken);
        expect(right.revealToken).not.toEqual(wrong.revealToken);
    });

    it("rejects a malformed payload before sealing", async () => {
        await expect(
            sealSharePayload({ ...payload, fields: [] }, generateShareSecret()),
        ).rejects.toThrow();
    });
});

describe("share links", () => {
    it("formats and parses a link", () => {
        const secret = generateShareSecret();
        const link = formatShareLink(
            "https://www.cryptex-vault.com/app",
            "AbCdEfGhIjKlMnOpQrStUv",
            secret,
        );

        expect(link).toBe(
            `https://www.cryptex-vault.com/s/AbCdEfGhIjKlMnOpQrStUv#${uint8ToBase64Url(secret)}`,
        );
        expect(parseShareLink(link)).toEqual({
            origin: "https://www.cryptex-vault.com",
            id: "AbCdEfGhIjKlMnOpQrStUv",
            secret,
        });
    });

    it("rejects links with a bad id or secret", () => {
        const secret = uint8ToBase64Url(generateShareSecret());

        expect(parseShareLink("https://x.test/s/short#" + secret)).toBeNull();
        expect(
            parseShareLink("https://x.test/s/AbCdEfGhIjKlMnOpQrStUv#abc"),
        ).toBeNull();
        expect(
            parseShareLink("https://x.test/p/AbCdEfGhIjKlMnOpQrStUv#" + secret),
        ).toBeNull();
        expect(parseShareLink("not a url")).toBeNull();
    });
});

describe("share payloads", () => {
    it("shares name, username, password and URLs by default", () => {
        expect(
            buildCredentialSharePayload(
                credential,
                defaultCredentialShareSelection(),
            ),
        ).toEqual({
            v: 1,
            title: "Mail",
            fields: [
                { label: "Username", value: "ana@example.com", kind: "text" },
                { label: "Password", value: "s3cret", kind: "secret" },
                {
                    label: "Website",
                    value: "https://mail.example.com",
                    kind: "url",
                },
                {
                    label: "Website",
                    value: "https://webmail.example.com",
                    kind: "url",
                },
            ],
        });
    });

    it("adds opted-in TOTP, custom fields and notes", () => {
        const result = buildCredentialSharePayload(credential, {
            name: false,
            username: false,
            password: false,
            url: false,
            notes: true,
            totp: true,
            sshPrivateKey: false,
            sshPublicKey: false,
            customFieldIds: ["pin"],
        });

        expect(result.title).toBe("");
        expect(result.fields.map((field) => field.kind)).toEqual([
            "totp",
            "secret",
            "multiline",
        ]);
        const totp = OTPAuth.URI.parse(result.fields[0]!.value);
        expect(totp).toBeInstanceOf(OTPAuth.TOTP);
        expect(totp.secret.base32).toBe("JBSWY3DPEHPK3PXP");
    });

    it("refuses an empty selection", () => {
        expect(() =>
            buildCredentialSharePayload(credential, {
                ...defaultCredentialShareSelection(),
                name: true,
                username: false,
                password: false,
                url: false,
            }),
        ).toThrow("SHARE_PAYLOAD_EMPTY");
        expect(() => buildTextSharePayload("   ")).toThrow(
            "SHARE_PAYLOAD_EMPTY",
        );
    });
});

describe("expiry choices", () => {
    it("offers only what the server keeps", () => {
        expect(shareExpiryOptions(604800).map((o) => o.seconds)).toEqual([
            3600, 86400, 259200, 604800,
        ]);
        expect(shareExpiryOptions(86400).map((o) => o.label)).toEqual([
            "1 hour",
            "1 day",
        ]);
        expect(shareExpiryOptions(1800)).toEqual([
            { seconds: 1800, label: "30 minutes" },
        ]);
        expect(defaultShareExpiry(shareExpiryOptions(604800))).toBe(86400);
        expect(defaultShareExpiry(shareExpiryOptions(3600))).toBe(3600);
    });
});
