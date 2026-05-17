import { describe, it, expect, jest } from "@jest/globals";

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
    }),
    { virtual: true },
);

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import { BACKUP_FILE_EXTENSION, REQUIRED_FIELD_ERROR } from "../../src/utils/consts";
import {
    GroupSchema,
    SynchronizationSTUNUpsertSchema,
    SynchronizationSignalingUpsertSchema,
    SynchronizationTURNUpsertSchema,
    TOTPFormSchema,
    editVaultFormSchema,
    encryptionFormGroupSchema,
    newVaultFormSchema,
    unlockVaultFormSchema,
    unlockVaultWCaptchaFormSchema,
    vaultEncryptionConfigurationsFormElement,
    vaultEncryptionFormElement,
    vaultEncryptionKeyDerivationFunctionFormElement,
    vaultRestoreFormSchema,
} from "../../src/app_lib/vault-utils/form-schemas";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "../../src/app_lib/vault-utils/encryption";

describe("vault-utils/form-schemas", () => {
    it("applies default encryption and key derivation values", () => {
        expect(vaultEncryptionFormElement.parse(undefined)).toBe(
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
        );
        expect(vaultEncryptionKeyDerivationFunctionFormElement.parse(undefined)).toBe(
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
        );
    });

    it("coerces encryption configuration and validates argon2 bounds", () => {
        const valid = vaultEncryptionConfigurationsFormElement.parse({
            memLimit: "8",
            opsLimit: "3",
            iterations: "250000",
        });

        expect(valid.memLimit).toBe(8);
        expect(valid.opsLimit).toBe(3);
        expect(valid.iterations).toBe(250000);

        expect(() =>
            vaultEncryptionConfigurationsFormElement.parse({
                memLimit: KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT - 1,
                opsLimit: KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            }),
        ).toThrow("Memory limit must be above");

        expect(() =>
            vaultEncryptionConfigurationsFormElement.parse({
                memLimit: KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT + 1,
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            }),
        ).toThrow("Operation limit must be between");
    });

    it("validates encryption form group secret requirement", () => {
        expect(() =>
            encryptionFormGroupSchema.parse({
                Secret: "",
                Encryption: VaultUtilTypes.EncryptionAlgorithm.AES256,
                EncryptionKeyDerivationFunction:
                    VaultUtilTypes.KeyDerivationFunction.PBKDF2,
                EncryptionConfig: {
                    memLimit: 4,
                    opsLimit: 2,
                    iterations: 100000,
                },
            }),
        ).toThrow(REQUIRED_FIELD_ERROR);

        const parsed = encryptionFormGroupSchema.parse({
            Secret: "vault-passphrase",
            Encryption: VaultUtilTypes.EncryptionAlgorithm.AES256,
            EncryptionKeyDerivationFunction:
                VaultUtilTypes.KeyDerivationFunction.PBKDF2,
            EncryptionConfig: {
                memLimit: 4,
                opsLimit: 2,
                iterations: 100000,
            },
        });
        expect(parsed.Secret).toBe("vault-passphrase");
    });

    it("validates new and edit vault form length constraints", () => {
        expect(() =>
            newVaultFormSchema.parse({
                Name: "",
                Description: "",
            }),
        ).toThrow(REQUIRED_FIELD_ERROR);

        expect(() =>
            editVaultFormSchema.parse({
                Name: "x".repeat(256),
                Description: "",
            }),
        ).toThrow("Name is too long");
    });

    it("validates captcha schema variants", () => {
        expect(unlockVaultFormSchema.parse({ CaptchaToken: "" }).CaptchaToken).toBe(
            "",
        );
        expect(() =>
            unlockVaultWCaptchaFormSchema.parse({ CaptchaToken: "" }),
        ).toThrow("Captcha is required.");
    });

    it("validates backup file extension for restore schema", () => {
        const validFile = new File(["data"], `vault.${BACKUP_FILE_EXTENSION}`);
        const parsed = vaultRestoreFormSchema.parse({
            Name: "Imported",
            Description: "desc",
            BackupFile: validFile,
        });
        expect(parsed.BackupFile.name).toBe(`vault.${BACKUP_FILE_EXTENSION}`);

        const invalidFile = new File(["data"], "vault.txt");
        expect(() =>
            vaultRestoreFormSchema.parse({
                Name: "Imported",
                Description: "desc",
                BackupFile: invalidFile,
            }),
        ).toThrow("File must be an encrypted backup file");
    });

    it("validates TOTP form values", () => {
        const parsed = TOTPFormSchema.parse({
            Label: "Account",
            Secret: "BASE32",
            Period: 30,
            Digits: 6,
            Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
        });
        expect(parsed.Algorithm).toBe(VaultUtilTypes.TOTPAlgorithm.SHA1);

        expect(() =>
            TOTPFormSchema.parse({
                Label: "A",
                Secret: "B",
                Period: 0,
                Digits: 1,
                Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
            }),
        ).toThrow("Period must be at least 1 second");
    });

    it("validates synchronization server upsert schemas", () => {
        const signaling = SynchronizationSignalingUpsertSchema.parse({
            ID: "id-1",
            Name: "Primary",
            AppID: "app",
            Key: "key",
            Secret: "secret",
            Host: "host",
            ServicePort: "80",
            SecureServicePort: "443",
        });
        expect(signaling.Name).toBe("Primary");

        const stun = SynchronizationSTUNUpsertSchema.parse({
            ID: "id-2",
            Name: "STUN",
            Host: "stun.example.com",
        });
        expect(stun.Host).toBe("stun.example.com");

        const turn = SynchronizationTURNUpsertSchema.parse({
            ID: "id-3",
            Name: "TURN",
            Host: "turn.example.com",
            Username: "user",
            Password: "pass",
        });
        expect(turn.Username).toBe("user");
    });

    it("rejects synchronization upsert schemas when required string fields are empty", () => {
        expect(() =>
            SynchronizationSTUNUpsertSchema.parse({
                ID: "id",
                Name: "STUN",
                Host: "",
            }),
        ).toThrow("Host is required");

        expect(() =>
            SynchronizationTURNUpsertSchema.parse({
                ID: "id",
                Name: "TURN",
                Host: "turn.example.com",
                Username: "",
                Password: "p",
            }),
        ).toThrow("Username is required");

        expect(() =>
            SynchronizationSignalingUpsertSchema.parse({
                ID: "id",
                Name: "Sig",
                AppID: "app",
                Key: "key",
                Secret: "secret",
                Host: "host",
                ServicePort: "",
                SecureServicePort: "443",
            }),
        ).toThrow("Service Port is required");
    });

    describe("GroupSchema", () => {
        it("parses a fully populated group", () => {
            const parsed = GroupSchema.parse({
                ID: "g1",
                Name: "Work",
                Icon: "briefcase",
                Color: "#ff0000",
            });
            expect(parsed).toEqual({
                ID: "g1",
                Name: "Work",
                Icon: "briefcase",
                Color: "#ff0000",
            });
        });

        it("allows null ID (new unsaved groups)", () => {
            const parsed = GroupSchema.parse({
                ID: null,
                Name: "Unsaved",
                Icon: "",
                Color: "",
            });
            expect(parsed.ID).toBeNull();
        });

        it("rejects non-string Name", () => {
            expect(() =>
                GroupSchema.parse({
                    ID: "g1",
                    Name: 42,
                    Icon: "",
                    Color: "",
                }),
            ).toThrow();
        });

        it("rejects missing fields", () => {
            expect(() =>
                GroupSchema.parse({
                    ID: "g1",
                    Name: "x",
                }),
            ).toThrow();
        });
    });

    describe("vaultEncryptionConfigurationsFormElement boundaries", () => {
        it("rejects opsLimit below MIN_OPS_LIMIT", () => {
            expect(() =>
                vaultEncryptionConfigurationsFormElement.parse({
                    memLimit: KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                    opsLimit: KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT - 1,
                    iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                }),
            ).toThrow("Operation limit must be between");
        });

        it("accepts opsLimit and memLimit at their min boundary", () => {
            const parsed = vaultEncryptionConfigurationsFormElement.parse({
                memLimit: KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT,
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            });
            expect(parsed.memLimit).toBe(
                KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT,
            );
            expect(parsed.opsLimit).toBe(
                KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT,
            );
        });

        it("accepts memLimit at MAX (no upper bound enforced) and opsLimit at MAX", () => {
            const parsed = vaultEncryptionConfigurationsFormElement.parse({
                memLimit: KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT,
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            });
            expect(parsed.memLimit).toBe(
                KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT,
            );
            expect(parsed.opsLimit).toBe(
                KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT,
            );
        });
    });

    describe("vault description max length", () => {
        it("accepts 500-char description (boundary)", () => {
            const desc = "d".repeat(500);
            expect(
                newVaultFormSchema.parse({ Name: "name", Description: desc })
                    .Description,
            ).toBe(desc);
            expect(
                editVaultFormSchema.parse({ Name: "name", Description: desc })
                    .Description,
            ).toBe(desc);
        });

        it("rejects 501-char description", () => {
            const desc = "d".repeat(501);
            expect(() =>
                newVaultFormSchema.parse({ Name: "name", Description: desc }),
            ).toThrow("Description is too long");
            expect(() =>
                editVaultFormSchema.parse({ Name: "name", Description: desc }),
            ).toThrow("Description is too long");
        });
    });

    describe("TOTPFormSchema boundaries", () => {
        it("rejects Digits below 1", () => {
            expect(() =>
                TOTPFormSchema.parse({
                    Label: "Label",
                    Secret: "S",
                    Period: 30,
                    Digits: 0,
                    Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
                }),
            ).toThrow("Digits must be at least 1");
        });

        it("accepts Digits=1 (min boundary)", () => {
            const parsed = TOTPFormSchema.parse({
                Label: "L",
                Secret: "S",
                Period: 1,
                Digits: 1,
                Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
            });
            expect(parsed.Digits).toBe(1);
            expect(parsed.Period).toBe(1);
        });

        it("rejects Label longer than 255 chars", () => {
            expect(() =>
                TOTPFormSchema.parse({
                    Label: "x".repeat(256),
                    Secret: "S",
                    Period: 30,
                    Digits: 6,
                    Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
                }),
            ).toThrow("Label is too long");
        });

        it("accepts Label of exactly 255 chars", () => {
            const parsed = TOTPFormSchema.parse({
                Label: "x".repeat(255),
                Secret: "S",
                Period: 30,
                Digits: 6,
                Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
            });
            expect(parsed.Label).toHaveLength(255);
        });
    });

    describe("Synchronization upsert Name length boundary (max 50)", () => {
        const longName = "n".repeat(51);
        const boundaryName = "n".repeat(50);

        it("rejects 51-char Name on Signaling schema", () => {
            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({
                    ID: "id",
                    Name: longName,
                    AppID: "a",
                    Key: "k",
                    Secret: "s",
                    Host: "h",
                    ServicePort: "80",
                    SecureServicePort: "443",
                }),
            ).toThrow("Name can not be longer than 50 characters");
        });

        it("rejects 51-char Name on STUN schema", () => {
            expect(() =>
                SynchronizationSTUNUpsertSchema.parse({
                    ID: "id",
                    Name: longName,
                    Host: "stun.example.com",
                }),
            ).toThrow("Name can not be longer than 50 characters");
        });

        it("rejects 51-char Name on TURN schema", () => {
            expect(() =>
                SynchronizationTURNUpsertSchema.parse({
                    ID: "id",
                    Name: longName,
                    Host: "turn.example.com",
                    Username: "u",
                    Password: "p",
                }),
            ).toThrow("Name can not be longer than 50 characters");
        });

        it("accepts 50-char Name on all three schemas (boundary)", () => {
            expect(
                SynchronizationSignalingUpsertSchema.parse({
                    ID: "id",
                    Name: boundaryName,
                    AppID: "a",
                    Key: "k",
                    Secret: "s",
                    Host: "h",
                    ServicePort: "80",
                    SecureServicePort: "443",
                }).Name,
            ).toBe(boundaryName);
            expect(
                SynchronizationSTUNUpsertSchema.parse({
                    ID: "id",
                    Name: boundaryName,
                    Host: "h",
                }).Name,
            ).toBe(boundaryName);
            expect(
                SynchronizationTURNUpsertSchema.parse({
                    ID: "id",
                    Name: boundaryName,
                    Host: "h",
                    Username: "u",
                    Password: "p",
                }).Name,
            ).toBe(boundaryName);
        });

        it("rejects empty Name across all three schemas", () => {
            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({
                    ID: "id",
                    Name: "",
                    AppID: "a",
                    Key: "k",
                    Secret: "s",
                    Host: "h",
                    ServicePort: "80",
                    SecureServicePort: "443",
                }),
            ).toThrow("Name is required");
            expect(() =>
                SynchronizationSTUNUpsertSchema.parse({
                    ID: "id",
                    Name: "",
                    Host: "h",
                }),
            ).toThrow("Name is required");
            expect(() =>
                SynchronizationTURNUpsertSchema.parse({
                    ID: "id",
                    Name: "",
                    Host: "h",
                    Username: "u",
                    Password: "p",
                }),
            ).toThrow("Name is required");
        });

        it("rejects missing AppID / Key / Secret / Host / SecureServicePort on Signaling", () => {
            const base = {
                ID: "id",
                Name: "Sig",
                AppID: "a",
                Key: "k",
                Secret: "s",
                Host: "h",
                ServicePort: "80",
                SecureServicePort: "443",
            };

            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({
                    ...base,
                    AppID: "",
                }),
            ).toThrow("Application ID is required");
            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({ ...base, Key: "" }),
            ).toThrow("Key is required");
            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({
                    ...base,
                    Secret: "",
                }),
            ).toThrow("The secret is required");
            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({
                    ...base,
                    Host: "",
                }),
            ).toThrow("Host is required");
            expect(() =>
                SynchronizationSignalingUpsertSchema.parse({
                    ...base,
                    SecureServicePort: "",
                }),
            ).toThrow("Secure Service Port is required");
        });

        it("rejects missing Password on TURN", () => {
            expect(() =>
                SynchronizationTURNUpsertSchema.parse({
                    ID: "id",
                    Name: "TURN",
                    Host: "h",
                    Username: "u",
                    Password: "",
                }),
            ).toThrow("Password is required");
        });
    });
});
