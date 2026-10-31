import { t } from "@lingui/core/macro";
import {
    ItemType,
    type SSHKeyData,
} from "@cryptex-industries/vault-core/proto";
import {
    describeSSHKey,
    type SSHKeyInfo,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";

/** Vault list filter for SSH key items. Directory IDs are ULIDs, so it can't clash. */
export const SSH_KEYS_FILTER = "ssh-keys";

type SSHKeyItem = Pick<VaultCredential, "Type" | "SSHKey">;

export function isSSHKeyItem(credential: Pick<VaultCredential, "Type">) {
    return credential.Type === ItemType.SSHKey;
}

const infoCache = new WeakMap<SSHKeyData, SSHKeyInfo | null>();

/** Label and fingerprint of an SSH key item, cached per stored key. */
export function sshKeyInfo(credential: SSHKeyItem): SSHKeyInfo | null {
    const data = credential.SSHKey;
    if (!isSSHKeyItem(credential) || !data) return null;
    if (!infoCache.has(data)) infoCache.set(data, describeSSHKey(data));
    return infoCache.get(data) ?? null;
}

/** Second line in lists: the key label, then the comment when there is one. */
export function sshKeySummary(credential: SSHKeyItem): string {
    const label = sshKeyInfo(credential)?.label ?? t`SSH key`;
    const comment = credential.SSHKey?.Comment.trim();
    return comment ? `${label}, ${comment}` : label;
}

let sshKeyModule:
    | Promise<
          typeof import("@cryptex-industries/vault-core/vault-utils/ssh-key")
      >
    | undefined;

/** The key generation code, loaded on first use. Import and export run on the key worker. */
export function loadSSHKeyModule() {
    sshKeyModule ??=
        import("@cryptex-industries/vault-core/vault-utils/ssh-key").catch(
            (error: unknown) => {
                sshKeyModule = undefined;
                throw error;
            },
        );
    return sshKeyModule;
}
