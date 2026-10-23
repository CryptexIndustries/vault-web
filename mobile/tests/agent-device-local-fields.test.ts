import { describe, expect, it, jest } from "@jest/globals";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";

const mockReencrypt = jest.fn(async (bytes: Uint8Array) => ({ bytes }));

jest.mock("react-native-mmkv", () => ({ MMKV: class {} }));
jest.mock("expo-secure-store", () => ({}));
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops",
    () => ({
        reencryptVaultBytesWithDEK: mockReencrypt,
    }),
);
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/envelope-encryption",
    () => ({
        ...jest.requireActual<object>(
            "@cryptex-industries/vault-core/vault-utils/envelope-encryption",
        ),
        isEnvelopeBlob: () => true,
    }),
);
jest.mock("@cryptex-industries/vault-core/proto", () => {
    const actual = jest.requireActual<
        typeof import("@cryptex-industries/vault-core/proto")
    >("@cryptex-industries/vault-core/proto");
    return {
        ...actual,
        EncryptedBlob: { encode: () => ({ finish: () => new Uint8Array() }) },
    };
});

const { serializeVault } =
    require("@/app_lib/vault-utils/storage") as typeof import("@/app_lib/vault-utils/storage");
const { decodeReceivedVault } =
    require("@/utils/received-vault") as typeof import("@/utils/received-vault");
const { unknownRelayMessage } =
    require("@/agent/relay-wording") as typeof import("@/agent/relay-wording");

function vaultWithDeviceLocalFields() {
    const vault = new Vault();
    vault.AgentApprover = {
        ...VaultUtilTypes.AgentApproverSettings.decode(new Uint8Array()),
        SignSeed: new Uint8Array(32).fill(1),
        KEMSeed: new Uint8Array(32).fill(2),
    };
    vault.ShareSettings = VaultUtilTypes.ShareSettings.decode(new Uint8Array());
    expect(
        VaultUtilTypes.Vault.decode(VaultUtilTypes.Vault.encode(vault).finish())
            .AgentApprover,
    ).toBeDefined();
    return vault;
}

describe("device-local vault fields", () => {
    it("backups and exports leave out the SSH agent approver identity", async () => {
        await serializeVault(
            vaultWithDeviceLocalFields(),
            { Envelope: {}, KDFConfigArgon2ID: undefined } as never,
            {} as CryptoKey,
        ).catch(() => undefined);
        const bytes = mockReencrypt.mock.calls[0]?.[0];
        expect(bytes).toBeDefined();
        expect(
            VaultUtilTypes.Vault.decode(bytes!).AgentApprover,
        ).toBeUndefined();
    });

    it("a received vault never keeps the sender's fields 12 and 14", () => {
        const bytes = VaultUtilTypes.Vault.encode(
            vaultWithDeviceLocalFields(),
        ).finish();
        const received = decodeReceivedVault(bytes);
        expect(received.AgentApprover).toBeUndefined();
        expect(received.ShareSettings).toBeUndefined();
    });
});

describe("pairing codes for an unknown relay", () => {
    it("don't call the relay the user's own", () => {
        const message = unknownRelayMessage("https://relay-example.evil/x", []);
        expect(message).toContain(
            "relay-example.evil that this phone doesn't know",
        );
        expect(message).not.toMatch(/your own relay at relay-example/);
        expect(message).not.toMatch(/its access token/i);
    });

    it("warn when the user already has a relay", () => {
        expect(
            unknownRelayMessage("https://relay-example.evil", [
                "https://relay.example.com",
            ]),
        ).toContain(
            "You already use your own relay at https://relay.example.com.",
        );
    });
});
