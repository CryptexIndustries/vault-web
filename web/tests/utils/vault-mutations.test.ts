/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import type { VaultMetadata } from "../../src/app_lib/vault-utils/storage";
import {
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "../../src/utils/atoms";
import { persistVaultMutation } from "../../src/utils/vault-mutations";
import {
    clearVaultDEKFromSession,
    setVaultDEKInSession,
} from "../../src/utils/vault-session";

const credential = (id: string) =>
    Object.assign(new VaultCredential(), { ID: id, Name: id });

describe("persistVaultMutation", () => {
    beforeEach(async () => {
        clearVaultDEKFromSession();
        setVaultDEKInSession(
            await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            ),
        );
        vaultStore.set(unlockedVaultAtom, new Vault());
        vaultStore.set(unlockedVaultMetadataAtom, null);
    });

    it("publishes the mutation only after persistence succeeds", async () => {
        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => {
            releaseSave = resolve;
        });
        const save = jest.fn(async () => saveGate);
        vaultStore.set(unlockedVaultMetadataAtom, {
            save,
        } as unknown as VaultMetadata);

        const pending = persistVaultMutation(
            "credential.upsert",
            (currentVault) => {
                const next = Object.assign(new Vault(), currentVault, {
                    Credentials: [...currentVault.Credentials, credential("a")],
                });
                return { vault: next, result: undefined };
            },
        );

        await Promise.resolve();
        expect(vaultStore.get(unlockedVaultAtom).Credentials).toHaveLength(0);

        releaseSave();
        await pending;
        expect(vaultStore.get(unlockedVaultAtom).Credentials).toEqual([
            expect.objectContaining({ ID: "a" }),
        ]);
    });

    it("serializes mutations and gives each one the latest committed vault", async () => {
        let releaseFirstSave!: () => void;
        const firstSaveGate = new Promise<void>((resolve) => {
            releaseFirstSave = resolve;
        });
        let markFirstSaveStarted!: () => void;
        const firstSaveStarted = new Promise<void>((resolve) => {
            markFirstSaveStarted = resolve;
        });
        let saveCount = 0;
        const save = jest.fn(async () => {
            saveCount += 1;
            if (saveCount === 1) {
                markFirstSaveStarted();
                await firstSaveGate;
            }
        });
        vaultStore.set(unlockedVaultMetadataAtom, {
            save,
        } as unknown as VaultMetadata);

        const add = (id: string) =>
            persistVaultMutation("credential.upsert", (currentVault) => {
                const next = Object.assign(new Vault(), currentVault, {
                    Credentials: [...currentVault.Credentials, credential(id)],
                });
                return { vault: next, result: undefined };
            });

        const first = add("a");
        const second = add("b");
        await firstSaveStarted;
        expect(save).toHaveBeenCalledTimes(1);

        releaseFirstSave();
        await Promise.all([first, second]);

        expect(save).toHaveBeenCalledTimes(2);
        expect(
            vaultStore
                .get(unlockedVaultAtom)
                .Credentials.map((entry) => entry.ID),
        ).toEqual(["a", "b"]);
    });

    it("keeps the current state when persistence fails", async () => {
        const original = new Vault();
        original.Credentials = [credential("original")];
        vaultStore.set(unlockedVaultAtom, original);
        vaultStore.set(unlockedVaultMetadataAtom, {
            save: jest.fn(async () => {
                throw new Error("disk full");
            }),
        } as unknown as VaultMetadata);

        const result = await persistVaultMutation(
            "credential.delete",
            (currentVault) => ({
                vault: Object.assign(new Vault(), currentVault, {
                    Credentials: [],
                }),
                result: undefined,
            }),
        );

        expect(result.isErr()).toBe(true);
        expect(vaultStore.get(unlockedVaultAtom)).toBe(original);
    });

    it("persists a mutation that returns the current vault", async () => {
        const original = new Vault();
        const save = jest.fn(async () => undefined);
        vaultStore.set(unlockedVaultAtom, original);
        vaultStore.set(unlockedVaultMetadataAtom, {
            save,
        } as unknown as VaultMetadata);

        const result = await persistVaultMutation(
            "vault.configuration",
            (currentVault) => ({ vault: currentVault, result: "unchanged" }),
        );

        expect(result.isOk() && result.value).toBe("unchanged");
        expect(save).toHaveBeenCalledTimes(1);
        expect(vaultStore.get(unlockedVaultAtom)).toBe(original);
    });
});
