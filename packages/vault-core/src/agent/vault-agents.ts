import { base64ToUint8, uint8ToBase64, uint8ToBase64Url } from "../encoding";
import { bytesEqual } from "../internal/ssh/wire";
import {
    ItemType,
    type AgentApproverSettings,
    type ConnectedAgent,
    type SSHKeyData,
} from "../proto/vault";
import {
    createConnectedAgentRecord,
    visibleConnectedAgents,
} from "../vault-utils/connected-agents";
import type { Vault, VaultCredential } from "../vault-utils/vault";
import type {
    ClaimedPairing,
    GrantedKeyInput,
    PairingResult,
} from "./approver-types";
import { identityId, identityPeer, type AgentIdentity } from "./envelope";
import { normalizeRelayUrl } from "./relay-client";
import { NAME_LENGTH, sanitizeDisplayText } from "./request-check";
import type { CachedAgent, GrantedKey, LocalAgentApproval } from "./runtime";

/**
 * Vault lookups and record changes for connected agents, shared by the
 * Android app and the web dashboard. Each app writes the results through
 * its own vault write queue.
 */

type SSHKeyItem = Pick<VaultCredential, "SSHKey">;

/** The SSH wire public key blob of a stored SSH key item. */
export function sshKeyBlob(credential: SSHKeyItem): Uint8Array | null {
    const base64 = credential.SSHKey?.PublicKey.trim().split(/\s+/)[1];
    if (!base64) return null;
    try {
        return base64ToUint8(base64);
    } catch {
        return null;
    }
}

export function liveAgent(
    vault: Pick<Vault, "ConnectedAgents">,
    agentId: string,
): ConnectedAgent | undefined {
    return (vault.ConnectedAgents ?? []).find(
        (agent) => agent.ID === agentId && !agent.Deleted,
    );
}

/** The SSH key items of the vault, in list order. */
export function sshKeyItems(
    vault: Pick<Vault, "Credentials">,
): VaultCredential[] {
    return vault.Credentials.filter(
        (credential) =>
            credential.Type === ItemType.SSHKey &&
            !credential.Deleted &&
            !!credential.SSHKey,
    );
}

/** The granted SSH key item whose public key a request names. */
export function findGrantedKey(
    vault: Pick<Vault, "ConnectedAgents" | "Credentials">,
    agentId: string,
    publicKey: Uint8Array,
): GrantedKey | null {
    const agent = liveAgent(vault, agentId);
    if (!agent) return null;
    for (const id of agent.CredentialIDs) {
        const credential = vault.Credentials.find(
            (item) => item.ID === id && !item.Deleted,
        );
        if (!credential?.SSHKey || credential.Type !== ItemType.SSHKey)
            continue;
        const blob = sshKeyBlob(credential);
        if (blob && bytesEqual(blob, publicKey))
            return {
                credentialId: id,
                name: credential.Name,
                sshKey: credential.SSHKey as SSHKeyData,
            };
    }
    return null;
}

/** This device approves the agent: it holds the approver key the agent pinned. */
export function isApprovedHere(
    agent: Pick<ConnectedAgent, "ApproverSignPublicKey">,
    identity: AgentIdentity | null | undefined,
) {
    return (
        !!identity &&
        bytesEqual(agent.ApproverSignPublicKey, identityId(identity))
    );
}

/**
 * The public data of the agents that name this device as approver, for the
 * runtime. Tombstones come too (deleted: true), so the runtime can remove
 * a revoked agent on its relay. The runtime still serves only agents in
 * its device-local approvals.
 */
export function agentCacheFromVault(
    vault: Pick<Vault, "ConnectedAgents" | "Credentials">,
    identity: AgentIdentity,
): CachedAgent[] {
    const records = vault.ConnectedAgents ?? [];
    const live = visibleConnectedAgents(records);
    const deleted = records.filter((agent) => agent.Deleted);
    return [...live, ...deleted]
        .filter((agent) => isApprovedHere(agent, identity))
        .map((agent) => ({
            id: agent.ID,
            name: agent.Name,
            signPublicKey: uint8ToBase64(agent.AgentSignPublicKey),
            kemPublicKey: uint8ToBase64(agent.AgentKEMPublicKey),
            relayOrigin: agent.RelayOrigin,
            grantedKeys: agent.CredentialIDs.flatMap((id) => {
                const credential = vault.Credentials.find(
                    (item) => item.ID === id && !item.Deleted,
                );
                const blob = credential ? sshKeyBlob(credential) : null;
                return blob ? [uint8ToBase64(blob)] : [];
            }),
            ...(agent.Paused && { paused: true }),
            ...(agent.Deleted && { deleted: true }),
        }));
}

/** The web's device-local approvals (Vault field 14) in the runtime's form. */
export function localApprovalsFromSettings(
    settings: Pick<AgentApproverSettings, "ApprovedAgents"> | undefined,
): LocalAgentApproval[] {
    return (settings?.ApprovedAgents ?? []).map((item) => ({
        agentId: item.AgentID,
        keys: item.Keys.map(uint8ToBase64),
    }));
}

/** The runtime's device-local approvals as Vault field 14 stores them. */
export function localApprovalsToSettings(
    approvals: readonly LocalAgentApproval[],
): AgentApproverSettings["ApprovedAgents"] {
    return approvals.map((item) => ({
        AgentID: item.agentId,
        Keys: item.keys.map(base64ToUint8),
    }));
}

/** This device paired the agent: it is in the device-local approvals. */
export function isApprovedLocally(
    approvals: readonly LocalAgentApproval[],
    agentId: string,
) {
    return approvals.some((item) => item.agentId === agentId);
}

/** The relay key (unpadded base64url) the hosted relay pass is bound to. */
export function relayKeyOf(identity: AgentIdentity) {
    return uint8ToBase64Url(identityId(identity));
}

/** What the agent gets for each granted item; ssh-add -L shows the comment. */
export function grantedKeyInputs(
    items: readonly Pick<VaultCredential, "Name" | "SSHKey">[],
): GrantedKeyInput[] {
    return items.flatMap((item) => {
        const blob = sshKeyBlob(item);
        return blob
            ? [
                  {
                      publicKey: blob,
                      comment: `${item.Name || "SSH key"} (Cryptex Vault)`,
                  },
              ]
            : [];
    });
}

/** The vault record for an agent once its PairingConfirm arrived. */
export function connectedAgentFromPairing(input: {
    claim: ClaimedPairing;
    result: PairingResult;
    agentName: string;
    credentialIds: string[];
    identity: AgentIdentity;
    approverName: string;
}): Promise<ConnectedAgent> {
    const { claim, result, identity } = input;
    const me = identityPeer(identity);
    return createConnectedAgentRecord({
        Name: input.agentName,
        AgentSignPublicKey: claim.offer.signPublicKey,
        AgentKEMPublicKey: claim.offer.kemPublicKey,
        Hostname: sanitizeDisplayText(claim.offer.hostname, NAME_LENGTH),
        OS: sanitizeDisplayText(claim.offer.os, 32),
        Arch: sanitizeDisplayText(claim.offer.arch, 32),
        AgentVersion: sanitizeDisplayText(claim.offer.agentVersion, 32),
        ApproverSignPublicKey: me.signPublicKey,
        ApproverKEMPublicKey: me.kemPublicKey,
        ApproverName: input.approverName,
        RevocationSeed: result.revocationSeed,
        // Keeps a base path, such as https://example.com/relay.
        RelayOrigin:
            claim.relay.kind === "hosted"
                ? ""
                : normalizeRelayUrl(claim.relay.url),
        CredentialIDs: [...input.credentialIds],
        KeysRevision: result.keysRevision,
    });
}

/** A shallow copy that keeps the vault's class. */
function cloneVault<V extends Pick<Vault, "ConnectedAgents">>(current: V): V {
    return Object.assign(
        Object.create(Object.getPrototypeOf(current) as object) as V,
        current,
    );
}

/** The vault with one agent record replaced; throws when it isn't there. */
export async function withAgentRecord<V extends Pick<Vault, "ConnectedAgents">>(
    current: V,
    agentId: string,
    update: (record: ConnectedAgent) => Promise<ConnectedAgent>,
): Promise<V> {
    const index = current.ConnectedAgents.findIndex(
        (agent) => agent.ID === agentId,
    );
    if (index < 0) throw new Error("Agent not found");
    const vault = cloneVault(current);
    vault.ConnectedAgents = [...current.ConnectedAgents];
    vault.ConnectedAgents[index] = await update(
        current.ConnectedAgents[index]!,
    );
    return vault;
}

/** The vault with a newly paired agent, replacing an earlier record of it. */
export function withNewAgentRecord<V extends Pick<Vault, "ConnectedAgents">>(
    current: V,
    record: ConnectedAgent,
): V {
    const vault = cloneVault(current);
    vault.ConnectedAgents = [
        ...current.ConnectedAgents.filter((agent) => agent.ID !== record.ID),
        record,
    ];
    return vault;
}
