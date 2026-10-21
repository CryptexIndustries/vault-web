/**
 * @jest-environment node
 *
 * The connected-agent lookups and page actions both apps share
 * (agent/vault-agents.ts and agent/agent-actions.ts).
 */
import { describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { revokeAgent } from "../agent/agent-actions";
import { generateAgentIdentity, identityId } from "../agent/envelope";
import {
    agentCacheFromVault,
    findGrantedKey,
    sshKeyItems,
} from "../agent/vault-agents";
import * as VaultUtilTypes from "../proto/vault";
import { createConnectedAgentRecord } from "../vault-utils/connected-agents";
import { Vault, VaultCredential } from "../vault-utils/vault";

const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

/** An SSH key item whose public key blob is [fill]. */
const sshKeyItem = (id: string, fill: number, deleted = false) =>
    Object.assign(new VaultCredential(), {
        ID: id,
        Name: id,
        Type: VaultUtilTypes.ItemType.SSHKey,
        Deleted: deleted,
        SSHKey: {
            PublicKey: `ssh-ed25519 ${btoa(String.fromCharCode(fill))}`,
            PrivateKey: "",
            Comment: "",
        },
    });

async function vaultWithAgent() {
    const identity = generateAgentIdentity();
    const vault = new Vault();
    vault.Credentials = [sshKeyItem("live", 1), sshKeyItem("deleted", 2, true)];
    const agent = await createConnectedAgentRecord({
        Name: "workstation",
        AgentSignPublicKey: bytes(32, 7),
        AgentKEMPublicKey: bytes(1216, 8),
        Hostname: "box",
        OS: "linux",
        Arch: "amd64",
        AgentVersion: "0.1.0",
        ApproverSignPublicKey: identityId(identity),
        ApproverKEMPublicKey: bytes(1216, 9),
        ApproverName: "Pixel",
        RevocationSeed: bytes(32, 10),
        RelayOrigin: "https://relay.example.com",
        // Both stay granted: deleting an item doesn't edit the agent record.
        CredentialIDs: ["live", "deleted"],
        KeysRevision: 1,
    });
    vault.ConnectedAgents = [agent];
    return { vault, agent, identity };
}

describe("deleted SSH key items", () => {
    it("are neither listed, signed with nor sent to the approver", async () => {
        const { vault, agent, identity } = await vaultWithAgent();
        expect(sshKeyItems(vault).map((item) => item.ID)).toEqual(["live"]);
        expect(
            findGrantedKey(vault, agent.ID, new Uint8Array([1]))?.credentialId,
        ).toBe("live");
        expect(findGrantedKey(vault, agent.ID, new Uint8Array([2]))).toBeNull();
        expect(agentCacheFromVault(vault, identity)[0]?.grantedKeys).toEqual([
            "AQ==",
        ]);
    });
});

describe("revoking an agent", () => {
    const relayAnswers = (status: number) =>
        jest.fn(async () => new Response(null, { status })) as never;
    const deps = (
        overrides: Partial<Parameters<typeof revokeAgent>[1]> = {},
    ) => ({
        approvedHere: false,
        unregister: async () => undefined,
        hostedRelayUrl: "https://relay.cryptex-vault.com",
        fetch: relayAnswers(204),
        markRevoked: jest.fn(async () => true),
        ...overrides,
    });

    it("falls back to the HTTP revoke when the approver can't reach the agent", async () => {
        const { agent } = await vaultWithAgent();
        const d = deps({
            approvedHere: true,
            unregister: async () => {
                throw new Error("offline");
            },
            fetch: relayAnswers(404),
        });
        await revokeAgent(agent, d);
        expect(d.fetch).toHaveBeenCalledWith(
            "https://relay.example.com/v1/revoke",
            expect.objectContaining({ method: "POST" }),
        );
        expect(d.markRevoked).toHaveBeenCalledWith(agent.ID);
    });

    it("writes the revocation even when the relay refuses or can't be reached", async () => {
        const { agent } = await vaultWithAgent();
        const markRevoked = jest.fn(async () => true);
        await expect(
            revokeAgent(agent, deps({ markRevoked, fetch: relayAnswers(403) })),
        ).resolves.toEqual({ relayRevoked: false });
        await expect(
            revokeAgent(
                agent,
                deps({
                    markRevoked,
                    fetch: (async () => {
                        throw new TypeError("blocked by the CSP");
                    }) as never,
                }),
            ),
        ).resolves.toEqual({ relayRevoked: false });
        expect(markRevoked).toHaveBeenCalledTimes(2);
    });

    it("saves the revocation first and stops waiting for a stalled relay", async () => {
        jest.useFakeTimers();
        try {
            const { agent } = await vaultWithAgent();
            const order: string[] = [];
            const fetch = jest.fn(
                () =>
                    new Promise<Response>(() => {
                        order.push("fetch");
                    }),
            );
            let result: unknown;
            void revokeAgent(
                agent,
                deps({
                    approvedHere: true,
                    unregister: () =>
                        new Promise<void>(() => {
                            order.push("unregister");
                        }),
                    fetch: fetch as never,
                    markRevoked: async () => {
                        order.push("vault");
                        return true;
                    },
                    relayTimeoutMs: 10_000,
                }),
            ).then((value) => (result = value));
            await jest.advanceTimersByTimeAsync(0);
            expect(order).toEqual(["vault", "unregister"]);
            await jest.advanceTimersByTimeAsync(10_000);
            // The relay connection never answered, nor would the HTTP revoke.
            expect(result).toEqual({ relayRevoked: false });
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("cancels a stalled HTTP revoke at the deadline", async () => {
        jest.useFakeTimers();
        try {
            const { agent } = await vaultWithAgent();
            let signal: AbortSignal | undefined;
            const fetch = jest.fn(
                (_url: string, init: RequestInit) =>
                    new Promise<Response>(() => {
                        signal = init.signal ?? undefined;
                    }),
            );
            const d = deps({ fetch: fetch as never });
            let result: unknown;
            void revokeAgent(agent, d).then((value) => (result = value));
            await jest.advanceTimersByTimeAsync(0);
            expect(d.markRevoked).toHaveBeenCalledWith(agent.ID);
            expect(fetch).toHaveBeenCalled();
            expect(signal?.aborted).toBe(false);
            await jest.advanceTimersByTimeAsync(20_000);
            expect(signal?.aborted).toBe(true);
            expect(result).toEqual({ relayRevoked: false });
        } finally {
            jest.useRealTimers();
        }
    });

    it("doesn't tell the relay when the vault write fails", async () => {
        const { agent } = await vaultWithAgent();
        const unregister = jest.fn(async () => undefined);
        const d = deps({
            approvedHere: true,
            unregister,
            markRevoked: async () => false,
        });
        await expect(revokeAgent(agent, d)).rejects.toThrow(/Couldn't save/);
        expect(unregister).not.toHaveBeenCalled();
        expect(d.fetch).not.toHaveBeenCalled();
    });

    it("never sends the revoke to a plain http relay other than this machine", async () => {
        const { agent } = await vaultWithAgent();
        const d = deps();
        await expect(
            revokeAgent({ ...agent, RelayOrigin: "http://relay.evil" }, d),
        ).resolves.toEqual({ relayRevoked: false });
        expect(d.fetch).not.toHaveBeenCalled();
        expect(d.markRevoked).toHaveBeenCalledWith(agent.ID);
        await expect(
            revokeAgent({ ...agent, RelayOrigin: "http://127.0.0.1:8080" }, d),
        ).resolves.toEqual({ relayRevoked: true });
        expect(d.fetch).toHaveBeenCalledWith(
            "http://127.0.0.1:8080/v1/revoke",
            expect.anything(),
        );
    });
});
