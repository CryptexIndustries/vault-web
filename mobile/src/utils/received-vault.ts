import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    LinkedDevices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";

/**
 * Decodes a vault sent by another device. Share server settings (field 12)
 * and the SSH agent approver identity (field 14) belong to one device; the
 * senders strip them, and a received copy never keeps them either.
 */
export function decodeReceivedVault(data: Uint8Array): Vault {
    const vault = Object.assign(new Vault(), VaultUtilTypes.Vault.decode(data));
    vault.ShareSettings = undefined;
    vault.AgentApprover = undefined;
    vault.LinkedDevices = LinkedDevices.fromGeneric(vault.LinkedDevices);
    return vault;
}
