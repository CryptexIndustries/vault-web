import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
} from "@jest/globals";

if (
    typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 !==
    "function"
) {
    Object.defineProperty(Uint8Array, "fromBase64", {
        value: (input: string) => {
            // Strict so invalid base64 throws (mirrors planned ESM behavior).
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
                throw new SyntaxError("invalid base64");
            }
            return new Uint8Array(Buffer.from(input, "base64"));
        },
        writable: true,
        configurable: true,
    });
}

if (
    typeof (Uint8Array.prototype as unknown as { toBase64?: unknown })
        .toBase64 !== "function"
) {
    Object.defineProperty(Uint8Array.prototype, "toBase64", {
        value(this: Uint8Array) {
            return Buffer.from(this).toString("base64");
        },
        writable: true,
        configurable: true,
    });
}

import {
    MISSING_VAULT_SECRET_ERROR,
    SESSION_STORAGE_VAULT_SECRET_KEY,
    clearVaultSecretFromSession,
    getVaultSecretFromSession,
    saveVaultWithSessionSecret,
    setVaultSecretInSession,
} from "../../src/utils/vault-session";

describe("vault-session", () => {
    beforeEach(() => {
        sessionStorage.clear();
        jest.clearAllMocks();
    });

    describe("getVaultSecretFromSession", () => {
        it("returns VAULT_SECRET_NOT_FOUND when key missing", () => {
            const res = getVaultSecretFromSession();
            expect(res.isErr()).toBe(true);
            if (res.isErr()) expect(res.error).toBe("VAULT_SECRET_NOT_FOUND");
        });

        it("returns VAULT_SECRET_NOT_FOUND when key is empty string", () => {
            sessionStorage.setItem(SESSION_STORAGE_VAULT_SECRET_KEY, "");
            const res = getVaultSecretFromSession();
            expect(res.isErr()).toBe(true);
        });

        it("returns ok on round-trip via setVaultSecretInSession", () => {
            const data = new Uint8Array([1, 2, 3, 4]);
            setVaultSecretInSession(data);

            const res = getVaultSecretFromSession();
            expect(res.isOk()).toBe(true);
            if (res.isOk()) {
                expect(Array.from(res.value)).toEqual([1, 2, 3, 4]);
            }
        });

        it("returns VAULT_SECRET_NOT_FOUND when stored base64 is invalid", () => {
            sessionStorage.setItem(
                SESSION_STORAGE_VAULT_SECRET_KEY,
                "!!!not-base64!!!",
            );
            const res = getVaultSecretFromSession();
            expect(res.isErr()).toBe(true);
            if (res.isErr()) expect(res.error).toBe("VAULT_SECRET_NOT_FOUND");
        });

        // Explicit assertion that the user-facing MISSING_VAULT_SECRET_ERROR
        // constant is exported alongside the typed error code. Source returns
        // the literal "VAULT_SECRET_NOT_FOUND" enum value (NOT the message
        // string) — these tests pin both contracts so callers can rely on them.
        it("MISSING_VAULT_SECRET_ERROR constant is exported and stable", () => {
            expect(typeof MISSING_VAULT_SECRET_ERROR).toBe("string");
            expect(MISSING_VAULT_SECRET_ERROR.length).toBeGreaterThan(0);
        });

        it("explicit: getVaultSecretFromSession err code is VAULT_SECRET_NOT_FOUND when key absent", () => {
            const res = getVaultSecretFromSession();
            expect(res.isErr()).toBe(true);
            if (res.isErr()) {
                expect(res.error).toBe("VAULT_SECRET_NOT_FOUND");
            }
        });

        it("explicit: getVaultSecretFromSession err code is VAULT_SECRET_NOT_FOUND when stored value is invalid base64", () => {
            sessionStorage.setItem(
                SESSION_STORAGE_VAULT_SECRET_KEY,
                "###invalid###",
            );
            const res = getVaultSecretFromSession();
            expect(res.isErr()).toBe(true);
            if (res.isErr()) {
                expect(res.error).toBe("VAULT_SECRET_NOT_FOUND");
            }
        });
    });

    describe("clearVaultSecretFromSession", () => {
        it("removes the key", () => {
            sessionStorage.setItem(SESSION_STORAGE_VAULT_SECRET_KEY, "abc");
            clearVaultSecretFromSession();
            expect(sessionStorage.getItem(SESSION_STORAGE_VAULT_SECRET_KEY)).toBeNull();
        });
    });

    describe("saveVaultWithSessionSecret", () => {
        it("returns VAULT_SECRET_NOT_FOUND when secret missing in session", async () => {
            const metadata = { save: jest.fn() };
            const result = await saveVaultWithSessionSecret(
                metadata as never,
                null,
            );
            expect(result.isErr()).toBe(true);
            if (result.isErr())
                expect(result.error).toBe("VAULT_SECRET_NOT_FOUND");
            expect(metadata.save).not.toHaveBeenCalled();
        });

        it("returns ok on successful save", async () => {
            setVaultSecretInSession(new Uint8Array([9, 9]));
            const save = jest.fn(async () => undefined);
            const metadata = { save };

            const result = await saveVaultWithSessionSecret(
                metadata as never,
                null,
            );
            expect(result.isOk()).toBe(true);
            expect(save).toHaveBeenCalledTimes(1);
        });

        it("returns VAULT_SAVE_FAILED when save throws", async () => {
            setVaultSecretInSession(new Uint8Array([9, 9]));
            const save = jest.fn(async () => {
                throw new Error("disk full");
            });
            const metadata = { save };

            const result = await saveVaultWithSessionSecret(
                metadata as never,
                null,
            );
            expect(result.isErr()).toBe(true);
            if (result.isErr()) expect(result.error).toBe("VAULT_SAVE_FAILED");
        });
    });
});
