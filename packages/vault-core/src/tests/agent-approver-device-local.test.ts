/**
 * @jest-environment node
 *
 * Vault.AgentApprover (this device's agent approver keys and relay tokens)
 * is device-local. A copy elsewhere could answer for agents paired here, so
 * no path that sends the vault to another device or file may carry it. The
 * web backup serializer is covered in web/tests/vault-utils/storage.test.ts.
 */
import { describe, expect, it } from "@jest/globals";

import { ONLINE_SERVICES_SELECTION_ID } from "../consts";
import {
    AgentApproverSettings,
    SyncItemType,
    SyncDataResponseMessage,
    Vault as VaultMessage,
} from "../proto/vault";
import { selectSyncItems } from "../sync-operations";
import { vaultToJSONString } from "../vault-utils/import-export";
import { packageForLinking, Vault } from "../vault-utils/vault";

const SIGN_SEED = new Uint8Array(32).fill(0xa5);
const KEM_SEED = new Uint8Array(32).fill(0x5a);
const TOKEN = "relay-token-that-must-stay-on-this-device";
const PASS = "relay-pass-that-must-stay-on-this-device";

const vaultWithApprover = () => {
    const vault = new Vault();
    vault.AgentApprover = AgentApproverSettings.fromPartial({
        SignSeed: SIGN_SEED,
        KEMSeed: KEM_SEED,
        CustomRelays: [{ Origin: "https://relay.example.com", Token: TOKEN }],
        RelayPass: PASS,
        RelayPassExpiresAt: Date.now() + 60_000,
    });
    return vault;
};

const contains = (haystack: Uint8Array, needle: Uint8Array) => {
    outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++)
            if (haystack[i + j] !== needle[j]) continue outer;
        return true;
    }
    return false;
};

const leaks = (bytes: Uint8Array) =>
    contains(bytes, SIGN_SEED) ||
    contains(bytes, KEM_SEED) ||
    contains(bytes, new TextEncoder().encode(TOKEN)) ||
    contains(bytes, new TextEncoder().encode(PASS));

describe("the device-local agent approver field", () => {
    it("is stored with this device's vault", () => {
        const bytes = VaultMessage.encode(vaultWithApprover()).finish();
        expect(leaks(bytes)).toBe(true);
        expect(VaultMessage.decode(bytes).AgentApprover?.SignSeed).toEqual(
            SIGN_SEED,
        );
    });

    it("stays out of the vault copy sent when linking a device", () => {
        const source = vaultWithApprover();
        const packaged = packageForLinking(
            source,
            "new-device-id",
            [],
            [],
            ONLINE_SERVICES_SELECTION_ID,
            "local-sync-public-key",
            "local-sync-kem-public-key",
        );
        expect(packaged.AgentApprover).toBeUndefined();
        expect(leaks(VaultMessage.encode(packaged).finish())).toBe(false);
        // The source vault keeps it.
        expect(source.AgentApprover?.SignSeed).toEqual(SIGN_SEED);
    });

    it("isn't part of what sync sends", () => {
        const vault = vaultWithApprover();
        const response = selectSyncItems(
            vault,
            [
                SyncItemType.CredentialItem,
                SyncItemType.DirectoryItem,
                SyncItemType.ShareLinkItem,
                SyncItemType.ConnectedAgentItem,
            ].map((Type) => ({ Type, ID: "any" })),
        );
        expect(leaks(SyncDataResponseMessage.encode(response).finish())).toBe(
            false,
        );
    });

    it("isn't in the JSON export", () => {
        const json = vaultToJSONString(vaultWithApprover());
        expect(json).not.toContain(TOKEN);
        expect(json).not.toContain(PASS);
        expect(json).not.toContain("AgentApprover");
    });
});
