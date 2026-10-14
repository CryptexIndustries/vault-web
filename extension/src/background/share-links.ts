import { z } from "zod";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";

// Popup messages are authenticated, but still validate before writing the vault.
const shareLinkSchema = z.object({
    ID: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    ServerOrigin: z.string().url().max(512),
    ManageToken: z.string().max(64),
    CredentialID: z.string().max(128),
    Label: z.string().max(256),
    CreatedAtTimestamp: z.number().int().nonnegative(),
    ExpiresAtTimestamp: z.number().int().nonnegative(),
    Passphrase: z.boolean(),
    Status: z.enum(["active", "viewed", "expired", "revoked", "burned"]),
    ViewedAtTimestamp: z.number().int().nonnegative(),
    Hash: z.string().max(128),
    Version: z.number().int().nonnegative(),
    DateModifiedTimestamp: z.number().int().nonnegative(),
    Deleted: z.boolean(),
});

const shareLinksPayloadSchema = z.object({
    shareLinks: z.array(shareLinkSchema).max(1000),
});

const shareSettingsPayloadSchema = z.object({
    settings: z.object({
        ServerOrigin: z.union([z.literal(""), z.string().url().max(512)]),
        CreationToken: z.string().max(512),
    }),
});

export function parseShareLinksPayload(
    payload: unknown,
): VaultUtilTypes.ShareLink[] | null {
    const parsed = shareLinksPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.shareLinks : null;
}

export function parseShareSettingsPayload(
    payload: unknown,
): VaultUtilTypes.ShareSettings | null {
    const parsed = shareSettingsPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.settings : null;
}
