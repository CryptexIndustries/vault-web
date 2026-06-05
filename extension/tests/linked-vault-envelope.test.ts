/**
 * @jest-environment node
 */
import { beforeAll, describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64"),
    }),
    { virtual: true },
);

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "../../web/src/app_lib/proto/vault";
import { KeyDerivationConfig_Argon2ID } from "../../web/src/app_lib/vault-utils/encryption";
import {
    decryptWithDEK,
    openPrimarySlot,
} from "../../web/src/app_lib/vault-utils/envelope-encryption";
import { createLinkedVaultEnvelopeBlob } from "../src/utils/linked-vault-envelope";

describe("linked vault envelope", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    it("creates an extension-local primary-slot envelope with recovery slot", async () => {
        const vaultId = "extension-local-vault";
        const plaintext = new TextEncoder().encode("linked vault bytes");
        const kdfConfig = new KeyDerivationConfig_Argon2ID(8, 1);

        const blob = await createLinkedVaultEnvelopeBlob(plaintext, {
            vaultId,
            masterPassword: "extension secret",
            kdfConfig,
        });

        expect(blob.Version).toBe(3);
        expect(blob.CurrentVersion).toBe(3);
        expect(blob.Algorithm).toBe(VaultUtilTypes.EncryptionAlgorithm.AES256);
        expect(blob.KeyDerivationFunc).toBe(
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
        );
        expect(blob.KDFConfigArgon2ID).toEqual({ memLimit: 8, opsLimit: 1 });
        expect(blob.KDFConfigPBKDF2).toBeUndefined();

        expect(blob.Envelope?.VaultID).toBe(vaultId);
        expect(blob.Envelope?.PrimaryFactorKind).toBe(
            VaultUtilTypes.SecondFactorKind.NONE,
        );
        expect(blob.Envelope?.Slots).toHaveLength(2);

        const [primarySlot, _recoverySlot] = blob.Envelope?.Slots ?? [];
        expect(primarySlot?.Kind).toBe(VaultUtilTypes.KeySlotKind.PRIMARY);
        expect(primarySlot?.FactorKind).toBe(VaultUtilTypes.SecondFactorKind.NONE);
        expect(primarySlot?.HKDFSalt).not.toBe("");
        expect(primarySlot?.HKDFInfo).toContain(vaultId);
        expect(
            blob.Envelope?.Slots.some(
                (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.RECOVERY,
            ),
        ).toBe(true);

        const opened = await openPrimarySlot(
            primarySlot as VaultUtilTypes.KeySlot & {
                Kind: VaultUtilTypes.KeySlotKind.PRIMARY;
            },
            "extension secret",
            "different-local-db-id",
            null,
        );
        expect(opened.isOk()).toBe(true);
        if (opened.isErr()) return;

        const decrypted = await decryptWithDEK(
            opened.value,
            blob.Blob,
            blob.HeaderIV,
        );
        expect(decrypted.isOk()).toBe(true);
        if (decrypted.isErr()) return;
        expect(new TextDecoder().decode(decrypted.value)).toBe(
            "linked vault bytes",
        );

        const wrongPassword = await openPrimarySlot(
            primarySlot as VaultUtilTypes.KeySlot & {
                Kind: VaultUtilTypes.KeySlotKind.PRIMARY;
            },
            "wrong secret",
            vaultId,
            null,
        );
        expect(wrongPassword.isErr()).toBe(true);
    });
});
