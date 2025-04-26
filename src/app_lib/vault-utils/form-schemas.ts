import { z } from "zod";

import { REQUIRED_FIELD_ERROR } from "../../utils/consts";
import * as VaultUtilTypes from "../proto/vault";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "./encryption";

export const vaultEncryptionFormElement = z
    .nativeEnum(VaultUtilTypes.EncryptionAlgorithm)
    .default(VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305);

export const vaultEncryptionKeyDerivationFunctionFormElement = z
    .nativeEnum(VaultUtilTypes.KeyDerivationFunction)
    .default(VaultUtilTypes.KeyDerivationFunction.Argon2ID);

export const vaultEncryptionConfigurationsFormElement = z.object({
    memLimit: z.coerce
        .number()
        .default(KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT)
        .refine(
            (x) => {
                return x >= KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT;
            },
            {
                message: `Memory limit must be above ${KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT}`,
            },
        ),
    opsLimit: z.coerce
        .number()
        .default(KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT)
        .refine(
            (x) => {
                return (
                    x >= KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT &&
                    x <= KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                );
            },
            {
                message: `Operation limit must be between ${KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT} and ${KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT}`,
            },
        ),
    iterations: z.coerce
        .number()
        .default(KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS),
});
export type VaultEncryptionConfigurationsFormElementType = z.infer<
    typeof vaultEncryptionConfigurationsFormElement
>;

// export const vaultEncryptionDescriptions = {
//     XChaCha20Poly1305:
//         "Uses Argon2ID under the hood - resistant to GPU and ASIC attacks (more secure), slower, and requires more memory.",
//     AES256: "Uses PBKDF2 under the hood - faster, not resistant to GPU and ASIC attacks (less secure).",
// };

export const unlockVaultFormSchema = z.object({
    CaptchaToken: z.string(),
});
export const unlockVaultWCaptchaFormSchema = unlockVaultFormSchema.extend({
    CaptchaToken: z.string().nonempty("Captcha is required."),
});

export const encryptionFormGroupSchema = z.object({
    Secret: z.string().min(1, REQUIRED_FIELD_ERROR),
    Encryption: vaultEncryptionFormElement,
    EncryptionKeyDerivationFunction:
        vaultEncryptionKeyDerivationFunctionFormElement,
    EncryptionConfig: vaultEncryptionConfigurationsFormElement,
});
export type EncryptionFormGroupSchemaType = z.infer<
    typeof encryptionFormGroupSchema
>;

export const newVaultFormSchema = z.object({
    Name: z.string().min(1, REQUIRED_FIELD_ERROR).max(255, "Name is too long"),
    Description: z.string().max(500, "Description is too long"),
});
export type NewVaultFormSchemaType = z.infer<typeof newVaultFormSchema>;

export const vaultRestoreFormSchema = z.object({
    Name: z.string().min(1, REQUIRED_FIELD_ERROR),
});
export type VaultRestoreFormSchema = z.infer<typeof vaultRestoreFormSchema>;

export const GroupSchema = z.object({
    ID: z.string().nullable(),
    Name: z.string(),
    Icon: z.string(),
    Color: z.string(),
});
export type GroupSchemaType = z.infer<typeof GroupSchema>;

export const TOTPFormSchema = z.object({
    Label: z.string().max(255, "Label is too long"),
    Secret: z.string(),
    Period: z.number().min(1, "Period must be at least 1 second"),
    Digits: z.number().min(1, "Digits must be at least 1"),
    Algorithm: z.nativeEnum(VaultUtilTypes.TOTPAlgorithm),
});
export type TOTPFormSchemaType = z.infer<typeof TOTPFormSchema>;

export const SynchronizationSignalingUpsertSchema = z.object({
    ID: z.string(),
    Name: z
        .string()
        .min(1, "Name is required")
        .max(50, "Name can not be longer than 50 characters"),
    AppID: z.string().min(1, "Application ID is required"),
    Key: z.string().min(1, "Key is required"),
    Secret: z.string().min(1, "The secret is required"),
    Host: z.string().min(1, "Host is required"),
    ServicePort: z.string().min(1, "Service Port is required"),
    SecureServicePort: z.string().min(1, "Secure Service Port is required"),
});
export type SynchronizationSignalingUpsertSchemaType = z.infer<
    typeof SynchronizationSignalingUpsertSchema
>;

export const SynchronizationSTUNUpsertSchema = z.object({
    ID: z.string(),
    Name: z
        .string()
        .min(1, "Name is required")
        .max(50, "Name can not be longer than 50 characters"),
    Host: z.string().min(1, "Host is required"),
});
export type SynchronizationSTUNUpsertSchemaType = z.infer<
    typeof SynchronizationSTUNUpsertSchema
>;

export const SynchronizationTURNUpsertSchema = z.object({
    ID: z.string(),
    Name: z
        .string()
        .min(1, "Name is required")
        .max(50, "Name can not be longer than 50 characters"),
    Host: z.string().min(1, "Host is required"),
    Username: z.string().min(1, "Username is required"),
    Password: z.string().min(1, "Password is required"),
});
export type SynchronizationTURNUpsertSchemaType = z.infer<
    typeof SynchronizationTURNUpsertSchema
>;
