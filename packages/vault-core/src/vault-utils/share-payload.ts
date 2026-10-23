/**
 * Builds one-time share payloads from vault items. Kept apart from
 * `share-link.ts` so the public recipient page doesn't pull in vault code.
 */

import * as OTPAuth from "otpauth";
import * as VaultUtilTypes from "../proto/vault";
import type { SharePayload } from "./share-link";
import { describeSSHKey, sshPublicKeyLine } from "./ssh-key-info";

type SharedCredential = Pick<
    VaultUtilTypes.Credential,
    | "Name"
    | "Username"
    | "Password"
    | "URL"
    | "AdditionalURLs"
    | "Notes"
    | "TOTP"
    | "CustomFields"
    | "SSHKey"
>;

export type CredentialShareSelection = {
    name: boolean;
    username: boolean;
    password: boolean;
    url: boolean;
    notes: boolean;
    totp: boolean;
    sshPrivateKey: boolean;
    sshPublicKey: boolean;
    /** IDs of the custom fields to include. */
    customFieldIds: string[];
};

/**
 * Name, username, password, URL and both halves of an SSH key on; everything
 * else needs an opt-in.
 */
export function defaultCredentialShareSelection(): CredentialShareSelection {
    return {
        name: true,
        username: true,
        password: true,
        url: true,
        notes: false,
        totp: false,
        sshPrivateKey: true,
        sshPublicKey: true,
        customFieldIds: [],
    };
}

export function totpToOtpauthUri(
    totp: VaultUtilTypes.TOTP,
    fallbackLabel: string,
): string {
    return new OTPAuth.TOTP({
        label: totp.Label || fallbackLabel || "Shared account",
        secret: OTPAuth.Secret.fromBase32(totp.Secret),
        algorithm: VaultUtilTypes.TOTPAlgorithm[totp.Algorithm],
        digits: totp.Digits,
        period: totp.Period,
    }).toString();
}

/**
 * Passkeys are never shared: their private key would stay usable after the
 * link burns, and the recipient couldn't use it from a web page anyway.
 */
export function buildCredentialSharePayload(
    credential: SharedCredential,
    selection: CredentialShareSelection,
): SharePayload {
    const fields: SharePayload["fields"] = [];
    const sshKey = credential.SSHKey;
    if (sshKey) {
        // Older share pages show any "secret" field, so the private key needs
        // no new field kind.
        if (selection.sshPrivateKey && sshKey.PrivateKey) {
            fields.push({
                label: "Private key",
                value: sshKey.PrivateKey,
                kind: "secret",
            });
        }
        if (selection.sshPublicKey && sshKey.PublicKey) {
            fields.push({
                label: "Public key",
                value: sshPublicKeyLine(sshKey),
                kind: "text",
            });
        }
        const info = fields.length > 0 ? describeSSHKey(sshKey) : null;
        if (info) {
            fields.push(
                { label: "Fingerprint", value: info.fingerprint, kind: "text" },
                { label: "Type", value: info.label, kind: "text" },
            );
        }
    }
    if (selection.username && credential.Username) {
        fields.push({
            label: "Username",
            value: credential.Username,
            kind: "text",
        });
    }
    if (selection.password && credential.Password) {
        fields.push({
            label: "Password",
            value: credential.Password,
            kind: "secret",
        });
    }
    if (selection.totp && credential.TOTP?.Secret) {
        fields.push({
            label: "One-time code",
            value: totpToOtpauthUri(credential.TOTP, credential.Name),
            kind: "totp",
        });
    }
    if (selection.url) {
        if (credential.URL) {
            fields.push({
                label: "Website",
                value: credential.URL,
                kind: "url",
            });
        }
        for (const additional of credential.AdditionalURLs) {
            if (additional.URL) {
                fields.push({
                    label: "Website",
                    value: additional.URL,
                    kind: "url",
                });
            }
        }
    }
    for (const field of credential.CustomFields) {
        if (!selection.customFieldIds.includes(field.ID)) continue;
        fields.push({
            label: field.Name || "Field",
            value: field.Value,
            kind:
                field.Type === VaultUtilTypes.CustomFieldType.MaskedText
                    ? "secret"
                    : "text",
        });
    }
    if (selection.notes && credential.Notes) {
        fields.push({
            label: "Notes",
            value: credential.Notes,
            kind: "multiline",
        });
    }
    if (fields.length === 0) {
        throw new Error("SHARE_PAYLOAD_EMPTY");
    }
    return {
        v: 1,
        title: selection.name ? credential.Name : "",
        fields,
    };
}

export function buildTextSharePayload(text: string, title = ""): SharePayload {
    if (!text.trim()) throw new Error("SHARE_PAYLOAD_EMPTY");
    return {
        v: 1,
        title,
        fields: [{ label: "Secret", value: text, kind: "multiline" }],
    };
}
