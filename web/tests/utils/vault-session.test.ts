/**
 * @jest-environment jsdom
 */
import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
} from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, writable: true });

import {
    clearVaultDEKFromSession,
    getVaultDEKFromSession,
    saveVaultWithSessionDEK,
    setVaultDEKInSession,
    setVaultDEKInSessionForMetadata,
} from "../../src/utils/vault-session";

describe("vault-session", () => {
    beforeEach(() => {
        clearVaultDEKFromSession();
        jest.clearAllMocks();
    });

    describe("getVaultDEKFromSession", () => {
        it("returns VAULT_DEK_NOT_FOUND when no active DEK", () => {
            const res = getVaultDEKFromSession();
            expect(res.isErr()).toBe(true);
            expect((res as { error: string }).error).toBe("VAULT_DEK_NOT_FOUND");
        });

        it("returns the same non-extractable DEK handle set in session", async () => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            setVaultDEKInSession(dek);

            const res = getVaultDEKFromSession();
            expect(res.isOk()).toBe(true);
            expect((res as { value: CryptoKey }).value).toBe(dek);
            expect((res as { value: CryptoKey }).value.extractable).toBe(false);
        });

        it("overwrites the active DEK when a new handle is set", async () => {
            const dek1 = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            const dek2 = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );

            setVaultDEKInSession(dek1);
            setVaultDEKInSession(dek2);

            const res = getVaultDEKFromSession();
            expect(res.isOk()).toBe(true);
            expect((res as { value: CryptoKey }).value).toBe(dek2);
        });
    });

    describe("clearVaultDEKFromSession", () => {
        it("clears active vault DEK", async () => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            setVaultDEKInSession(dek);
            clearVaultDEKFromSession();
            const res = getVaultDEKFromSession();
            expect(res.isErr()).toBe(true);
            expect((res as { error: string }).error).toBe("VAULT_DEK_NOT_FOUND");
        });
    });

    describe("setVaultDEKInSessionForMetadata", () => {
        it("sets active DEK for persisted vault metadata", async () => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );

            setVaultDEKInSessionForMetadata({ DBIndex: 1 } as never, dek);

            const res = getVaultDEKFromSession();
            expect(res.isOk()).toBe(true);
            expect((res as { value: CryptoKey }).value).toBe(dek);
        });

        it("does not set active DEK for unsaved metadata", async () => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );

            setVaultDEKInSessionForMetadata({ DBIndex: undefined } as never, dek);

            const res = getVaultDEKFromSession();
            expect(res.isErr()).toBe(true);
            expect((res as { error: string }).error).toBe("VAULT_DEK_NOT_FOUND");
        });

        it("does not set active DEK from legacy byte secrets", () => {
            setVaultDEKInSessionForMetadata(
                { DBIndex: 1 } as never,
                new Uint8Array([1, 2, 3]),
            );

            const res = getVaultDEKFromSession();
            expect(res.isErr()).toBe(true);
            expect((res as { error: string }).error).toBe("VAULT_DEK_NOT_FOUND");
        });
    });

    describe("saveVaultWithSessionDEK", () => {
        it("returns VAULT_DEK_NOT_FOUND when DEK missing in session", async () => {
            const metadata = { save: jest.fn() };
            const result = await saveVaultWithSessionDEK(metadata as never, null);
            expect(result.isErr()).toBe(true);
            expect((result as { error: string }).error).toBe(
                "VAULT_DEK_NOT_FOUND",
            );
            expect(metadata.save).not.toHaveBeenCalled();
        });

        it("returns ok on successful save", async () => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            setVaultDEKInSession(dek);
            const save = jest.fn(async () => undefined);
            const metadata = { save };

            const result = await saveVaultWithSessionDEK(metadata as never, null);
            expect(result.isOk()).toBe(true);
            expect(save).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith(null, dek);
        });

        it("returns VAULT_SAVE_FAILED when save throws", async () => {
            const dek = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            setVaultDEKInSession(dek);
            const save = jest.fn(async () => {
                throw new Error("disk full");
            });
            const metadata = { save };

            const result = await saveVaultWithSessionDEK(metadata as never, null);
            expect(result.isErr()).toBe(true);
            expect((result as { error: string }).error).toBe("VAULT_SAVE_FAILED");
        });
    });
});
