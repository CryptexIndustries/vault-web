import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

import * as OTPAuth from "otpauth";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) =>
            Buffer.from(value).toString("base64"),
        base64UrlToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64url")),
        uint8ToBase64Url: (value: Uint8Array) =>
            Buffer.from(value).toString("base64url"),
    }),
    { virtual: true },
);

import {
    CredentialFormSchema,
    CustomField,
    Group,
    LinkedDevice,
    LinkedDevices,
    OnlineServices,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TURNServerConfiguration,
    TOTP,
    Vault,
    VaultCredential,
    assimilateImportedCredential,
    calculateTOTP,
    createCredential,
    deleteCredential,
    hashCredential,
    hashCredentials,
    packageForLinking,
    updateCredentialFromForm,
    upsertGroup,
    type CredentialFormSchemaType,
} from "../../src/app_lib/vault-utils/vault";
import { ONLINE_SERVICES_SELECTION_ID } from "../../src/utils/consts";
import {
    CustomFieldType,
    ItemType,
    TOTPAlgorithm,
    type Credential as VaultUtilCredential,
} from "../../src/app_lib/proto/vault";

const buildForm = (
    overrides: Partial<CredentialFormSchemaType> = {},
): CredentialFormSchemaType => ({
    ID: overrides.ID ?? null,
    Type: overrides.Type ?? ItemType.Credentials,
    GroupID: overrides.GroupID ?? "group-1",
    Name: overrides.Name ?? "Credential name",
    Username: overrides.Username ?? "alice",
    Password: overrides.Password ?? "s3cret",
    TOTP: overrides.TOTP,
    Tags: overrides.Tags,
    URL: overrides.URL ?? "https://example.com",
    Notes: overrides.Notes ?? "note",
    CustomFields: overrides.CustomFields ?? [],
});

describe("vault-utils/vault", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("seeds vault credentials when requested", () => {
        const vault = new Vault(true, 2);

        expect(vault.Credentials).toHaveLength(2);
        expect(vault.Credentials[0]?.Name).toBe("Test Credential 0");
        expect(vault.Credentials[1]?.Username).toBe("Test Username 1");
    });

    it("upgrades legacy vault credentials to timestamp fields", () => {
        const legacy = new Vault();
        legacy.Version = 1;
        legacy.CurrentVersion = 0;

        const credential = new VaultCredential(
            buildForm({
                Name: "Legacy",
                Password: "pw",
            }),
        );
        credential.DateCreated = "2025-01-01T00:00:00.000Z";
        credential.DateModified = "2025-01-02T00:00:00.000Z";
        credential.DatePasswordChanged = "2025-01-03T00:00:00.000Z";
        legacy.Credentials = [credential];

        legacy.upgrade();

        expect(legacy.CurrentVersion).toBe(3);
        expect(legacy.Credentials[0]?.DateCreatedTimestamp).toBe(
            new Date("2025-01-01T00:00:00.000Z").getTime(),
        );
        expect(legacy.Credentials[0]?.DateModifiedTimestamp).toBe(
            new Date("2025-01-02T00:00:00.000Z").getTime(),
        );
        expect(legacy.Credentials[0]?.DatePasswordChangedTimestamp).toBe(
            new Date("2025-01-03T00:00:00.000Z").getTime(),
        );
    });

    it("handles linked device mutators and guards empty names", () => {
        const device = new LinkedDevice(
            "Device A",
            "sync-a",
            "remote-key-a",
            "remote-kem-a",
        );

        device.Name = "Renamed";
        device.AutoConnect = false;
        device.SyncTimeout = true;
        device.SyncTimeoutPeriod = 15;
        device.STUNServerIDs = ["stun-1"];
        device.TURNServerIDs = ["turn-1"];
        device.SignalingServerID = "sig-1";
        device.LastSync = new Date().toISOString();

        expect(device.Name).toBe("Renamed");
        expect(device.AutoConnect).toBe(false);
        expect(device.SyncTimeout).toBe(true);
        expect(device.SyncTimeoutPeriod).toBe(15);
        expect(device.STUNServerIDs).toEqual(["stun-1"]);
        expect(device.TURNServerIDs).toEqual(["turn-1"]);
        expect(device.SignalingServerID).toBe("sig-1");
        expect(device.LastSync).toBeTruthy();
    });

    it("creates linked devices and removes devices by id", () => {
        const linked = new LinkedDevices();
        LinkedDevices.addLinkedDevice(
            linked,
            "Device 1",
            "sync-1",
            "remote-key-1",
            "remote-kem-1",
            ["stun-a"],
            ["turn-a"],
            "sig-a",
            111,
            false,
            true,
            60,
        );

        expect(linked.Devices).toHaveLength(1);
        const added = linked.Devices[0]!;
        expect(added).toMatchObject({
            Name: "Device 1",
            SyncID: "sync-1",
            STUNServerIDs: ["stun-a"],
            TURNServerIDs: ["turn-a"],
            SignalingServerID: "sig-a",
            LinkedAtTimestamp: 111,
            AutoConnect: false,
            SyncTimeout: true,
            SyncTimeoutPeriod: 60,
        });
        expect(added.ID).toMatch(/^[0-9A-Z]{26}$/);

        const updated = LinkedDevices.removeLinkedDevice(
            linked.Devices,
            added.ID,
        );
        expect(updated).toEqual([]);
    });

    it("creates runtime class instances from generic linked devices payload", () => {
        const raw: LinkedDevices = Object.assign(new LinkedDevices(), {
            Devices: [{ ID: "d1", Name: "D1" }],
            STUNServers: [
                { ID: "s1", Name: "S1", Host: "stun://a", Version: 1 },
            ],
            TURNServers: [
                {
                    ID: "t1",
                    Name: "T1",
                    Host: "turn://a",
                    Username: "u",
                    Password: "p",
                    Version: 1,
                },
            ],
            SignalingServers: [
                {
                    ID: "g1",
                    Name: "Sig",
                    AppID: "app",
                    Key: "key",
                    Secret: "secret",
                    Host: "host",
                    ServicePort: "80",
                    SecureServicePort: "443",
                    Version: 1,
                },
            ],
        });

        const hydrated = LinkedDevices.fromGeneric(raw);
        expect(hydrated.Devices[0]).toBeInstanceOf(LinkedDevice);
        expect(hydrated.STUNServers[0]).toBeDefined();
        expect(hydrated.TURNServers[0]).toBeDefined();
        expect(hydrated.SignalingServers[0]).toBeDefined();
    });

    it("calculates TOTP code and time remaining", () => {
        jest.spyOn(OTPAuth.TOTP, "generate").mockReturnValue("123456");
        jest.spyOn(Date.prototype, "getSeconds").mockReturnValue(20);

        const totp = new TOTP();
        totp.Secret = "JBSWY3DPEHPK3PXP";
        totp.Digits = 6;
        totp.Period = 30;
        totp.Algorithm = TOTPAlgorithm.SHA1;

        const result = calculateTOTP(totp);

        expect(result.code).toBe("123456");
        expect(result.timeRemaining).toBe(10);
    });

    it("initializes custom fields with default values", () => {
        const field = new CustomField();

        expect(field).toMatchObject({
            ID: "-1",
            Name: "",
            Type: CustomFieldType.Text,
            Value: "",
        });
    });

    it("passes the expected TOTP parameters to the generator", () => {
        const generateSpy = jest
            .spyOn(OTPAuth.TOTP, "generate")
            .mockReturnValue("654321");
        jest.spyOn(Date.prototype, "getSeconds").mockReturnValue(0);

        const totp = new TOTP();
        totp.Secret = "JBSWY3DPEHPK3PXP";
        totp.Digits = 8;
        totp.Period = 60;
        totp.Algorithm = TOTPAlgorithm.SHA256;

        const result = calculateTOTP(totp);

        expect(result).toEqual({
            code: "654321",
            timeRemaining: 60,
        });
        expect(generateSpy).toHaveBeenCalledTimes(1);
        expect(generateSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                algorithm: "SHA256",
                digits: 8,
                period: 60,
            }),
        );
    });

    it("creates credential with computed hash", async () => {
        const credential = await createCredential(
            buildForm({
                Name: "GitHub",
                Password: "pw1",
                CustomFields: [
                    {
                        ID: "f1",
                        Name: "token",
                        Type: CustomFieldType.Text,
                        Value: "abc",
                    },
                ],
            }),
        );

        expect(credential.Name).toBe("GitHub");
        expect(credential.Hash).toMatch(/^[a-f0-9]{40}$/);
    });

    it("updates credential fields, increments version and updates password timestamp", async () => {
        const existing = await createCredential(
            buildForm({
                Name: "Old",
                Username: "old-user",
                Password: "old-pw",
            }),
        );
        existing.Version = 2;
        existing.DatePasswordChangedTimestamp = 10;

        jest.spyOn(Date, "now").mockReturnValue(2000);

        const updated = await updateCredentialFromForm(
            existing,
            buildForm({
                Name: "New",
                Username: "new-user",
                Password: "new-pw",
                TOTP: {
                    Label: "label",
                    Secret: "BASE32",
                    Period: 30,
                    Digits: 6,
                    Algorithm: TOTPAlgorithm.SHA1,
                },
                CustomFields: [
                    {
                        ID: "cf-1",
                        Name: "Environment",
                        Type: CustomFieldType.Text,
                        Value: "Production",
                    },
                    {
                        ID: "cf-2",
                        Name: "RecoveryCode",
                        Type: CustomFieldType.MaskedText,
                        Value: "RC-12345",
                    },
                ],
            }),
        );

        expect(updated.Name).toBe("New");
        expect(updated.Username).toBe("new-user");
        expect(updated.DateModifiedTimestamp).toBe(2000);
        expect(updated.DatePasswordChangedTimestamp).toBe(2000);
        expect(updated.Version).toBe(3);
        expect(updated.Hash).toMatch(/^[a-f0-9]{40}$/);
        expect(updated.TOTP).toBeInstanceOf(TOTP);
        expect(updated.CustomFields).toEqual([
            {
                ID: "cf-1",
                Name: "Environment",
                Type: CustomFieldType.Text,
                Value: "Production",
            },
            {
                ID: "cf-2",
                Name: "RecoveryCode",
                Type: CustomFieldType.MaskedText,
                Value: "RC-12345",
            },
        ]);
    });

    it("does not mutate the source credential and keeps password timestamp when password is unchanged", async () => {
        const existing = await createCredential(
            buildForm({
                Name: "Original",
                Username: "alice",
                Password: "same-password",
            }),
        );
        existing.Version = 4;
        existing.DatePasswordChangedTimestamp = 111;
        const originalDateModified = existing.DateModifiedTimestamp;
        const originalHash = existing.Hash;

        jest.spyOn(Date, "now").mockReturnValue(5000);

        const updated = await updateCredentialFromForm(
            existing,
            buildForm({
                Name: "Renamed",
                Username: "alice-updated",
                Password: "same-password",
            }),
        );

        expect(updated.Name).toBe("Renamed");
        expect(updated.Username).toBe("alice-updated");
        expect(updated.DateModifiedTimestamp).toBe(5000);
        expect(updated.DatePasswordChangedTimestamp).toBe(111);
        expect(updated.Version).toBe(5);

        expect(existing.Name).toBe("Original");
        expect(existing.Username).toBe("alice");
        expect(existing.Version).toBe(4);
        expect(existing.DateModifiedTimestamp).toBe(originalDateModified);
        expect(existing.DatePasswordChangedTimestamp).toBe(111);
        expect(existing.Hash).toBe(originalHash);
    });

    it("marks credential as deleted and strips sensitive data", async () => {
        const credential = await createCredential(
            buildForm({
                Name: "To Delete",
                Password: "pw",
            }),
        );
        credential.Version = 5;
        const list = [credential];

        jest.spyOn(Date, "now").mockReturnValue(1234);
        const result = await deleteCredential(list, credential.ID);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).toHaveLength(1);
            expect(result.value[0]).toMatchObject({
                ID: credential.ID,
                Deleted: true,
                Version: 6,
                Name: "Unnamed item",
                Password: "",
                DateModifiedTimestamp: 1234,
            });
        }
    });

    it("returns an error when deleting a missing credential", async () => {
        const result = await deleteCredential([], "missing-id");
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("Credential not found");
        }
    });

    it("produces stable credential hash independent of array order", async () => {
        const a = await createCredential(buildForm({ ID: "01A", Name: "A" }));
        const b = await createCredential(buildForm({ ID: "01B", Name: "B" }));

        const hashAB = await hashCredentials([a, b]);
        const hashBA = await hashCredentials([b, a]);

        expect(hashAB).toBe(hashBA);
        expect(hashAB).toMatch(/^[a-f0-9]{40}$/);
    });

    it("changes individual credential hash when sensitive fields change", async () => {
        const credential = new VaultCredential(
            buildForm({
                ID: "id-1",
                Name: "Name",
                Password: "pw",
            }),
        );

        const hashA = await hashCredential(credential);
        credential.Password = "pw-changed";
        const hashB = await hashCredential(credential);

        expect(hashA).not.toBe(hashB);
    });

    it("changes credential hash when TOTP secret changes", async () => {
        const credential = new VaultCredential(
            buildForm({
                ID: "id-totp",
                Name: "With TOTP",
                Password: "pw",
                TOTP: {
                    Label: "vault",
                    Secret: "JBSWY3DPEHPK3PXP",
                    Period: 30,
                    Digits: 6,
                    Algorithm: TOTPAlgorithm.SHA1,
                },
            }),
        );

        const hashA = await hashCredential(credential);
        credential.TOTP = {
            ...credential.TOTP!,
            Secret: "KRUGS4ZANFZSAYJA",
        };
        const hashB = await hashCredential(credential);

        expect(hashA).not.toBe(hashB);
    });

    it("changes credential hash when custom fields are changed or reordered", async () => {
        const credential = new VaultCredential(
            buildForm({
                ID: "id-custom-fields",
                Name: "With custom fields",
                Password: "pw",
                CustomFields: [
                    {
                        ID: "cf-1",
                        Name: "label",
                        Type: CustomFieldType.Text,
                        Value: "alpha",
                    },
                    {
                        ID: "cf-2",
                        Name: "secret",
                        Type: CustomFieldType.MaskedText,
                        Value: "beta",
                    },
                ],
            }),
        );

        const hashA = await hashCredential(credential);

        const firstField = credential.CustomFields[0]!;
        credential.CustomFields[0] = {
            ID: firstField.ID,
            Name: firstField.Name,
            Type: firstField.Type,
            Value: "alpha-updated",
        };
        const hashB = await hashCredential(credential);
        expect(hashB).not.toBe(hashA);

        credential.CustomFields = [...credential.CustomFields].reverse();
        const hashC = await hashCredential(credential);
        expect(hashC).not.toBe(hashB);
    });

    it("keeps credential hash stable when only volatile metadata changes", async () => {
        const credential = await createCredential(
            buildForm({
                ID: "id-stable",
                Name: "Stable",
                Password: "pw",
            }),
        );
        const hashA = await hashCredential(credential);

        credential.Version += 10;
        credential.DateCreatedTimestamp += 1000;
        credential.DateModifiedTimestamp += 1000;
        credential.DatePasswordChangedTimestamp += 1000;
        credential.Hash = "deadbeef";

        const hashB = await hashCredential(credential);
        expect(hashB).toBe(hashA);
    });

    it("upserts groups for both create and update paths", () => {
        const created = upsertGroup(null, {
            ID: "group-id",
            Name: "Personal",
            Icon: "home",
            Color: "red",
        });
        expect(created).toBeInstanceOf(Group);
        expect(created.ID).toBe("group-id");

        const updated = upsertGroup(created, {
            ID: created.ID,
            Name: "Updated",
            Icon: "star",
            Color: "blue",
        });
        expect(updated).toBe(created);
        expect(updated.Name).toBe("Updated");
        expect(updated.Icon).toBe("star");
        expect(updated.Color).toBe("blue");
    });

    it("assimilates imported credential by generating a new ID and hash", async () => {
        const imported: VaultUtilCredential = {
            ID: "imported-id",
            Type: ItemType.Credentials,
            GroupID: "group-1",
            Name: "Imported",
            Username: "user",
            Password: "pw",
            URL: "",
            Notes: "",
            DateCreated: new Date().toISOString(),
            DateModified: undefined,
            DatePasswordChanged: undefined,
            CustomFields: [],
            Version: 0,
            DateCreatedTimestamp: 1,
            DateModifiedTimestamp: 1,
            DatePasswordChangedTimestamp: 1,
            Deleted: false,
            Hash: "",
        };

        const assimilated = await assimilateImportedCredential(imported);
        expect(assimilated.ID).not.toBe("imported-id");
        expect(assimilated.Name).toBe("Imported");
        expect(assimilated.Hash).toMatch(/^[a-f0-9]{40}$/);
    });

    it("packages vault for linking without mutating original linked devices", () => {
        const source = new Vault();
        source.LinkedDevices.STUNServers = [
            { ID: "stun-a", Name: "STUN A", Host: "stun://a", Version: 1 },
        ];
        source.LinkedDevices.TURNServers = [
            {
                ID: "turn-a",
                Name: "TURN A",
                Host: "turn://a",
                Username: "u",
                Password: "p",
                Version: 1,
            },
        ];
        source.LinkedDevices.SignalingServers = [
            {
                ID: "sig-a",
                Name: "SIG A",
                AppID: "app",
                Key: "key",
                Secret: "secret",
                Host: "host",
                ServicePort: "80",
                SecureServicePort: "443",
                Version: 1,
            },
        ];
        LinkedDevices.addLinkedDevice(
            source.LinkedDevices,
            "Peer Device",
            "peer-sync",
            "peer-remote-key",
            "peer-remote-kem",
            ["stun-a"],
            ["turn-a"],
            "sig-a",
            1500,
            true,
            false,
            30,
        );

        const packaged = packageForLinking(
            source,
            "new-device-id",
            ["stun-new"],
            ["turn-new"],
            ONLINE_SERVICES_SELECTION_ID,
            "local-sync-public-key",
            "local-sync-kem-public-key",
        );

        expect(packaged).not.toBe(source);
        expect(packaged.LinkedDevices.Devices).toHaveLength(1);
        expect(packaged.LinkedDevices.Devices[0]).toMatchObject({
            Name: "Root Device",
            SyncID: "new-device-id",
            STUNServerIDs: ["stun-new"],
            TURNServerIDs: ["turn-new"],
            SignalingServerID: ONLINE_SERVICES_SELECTION_ID,
        });
        expect(source.LinkedDevices.Devices).toHaveLength(1);
        expect(source.LinkedDevices.Devices[0]?.Name).toBe("Peer Device");
    });
});

describe("Vault online services binding", () => {
    it("binds and unbinds OnlineServices and reports the bound status", () => {
        const vault = new Vault();
        const onlineServices = new OnlineServices(
            "device-1",
            "user-1",
            "pub-jwk",
            "priv-jwk",
        );

        expect(Vault.isOnlineServicesBound(vault)).toBe(false);

        Vault.bindOnlineServices(vault, onlineServices);
        expect(vault.OnlineServices).toBe(onlineServices);
        expect(Vault.isOnlineServicesBound(vault)).toBe(true);

        Vault.unbindOnlineServices(vault);
        expect(vault.OnlineServices).toBeUndefined();
        expect(Vault.isOnlineServicesBound(vault)).toBe(false);
    });
});

describe("LinkedDevices.isUsingOnlineServices", () => {
    it("returns true when STUN list is empty", () => {
        const device = new LinkedDevice(
            "n",
            "s",
            "remote-key",
            "remote-kem",
            Date.now(),
            true,
            false,
            30,
            [],
            ["turn-1"],
            "sig-1",
        );
        expect(LinkedDevices.isUsingOnlineServices(device)).toBe(true);
    });

    it("returns true when TURN list is empty", () => {
        const device = new LinkedDevice(
            "n",
            "s",
            "remote-key",
            "remote-kem",
            Date.now(),
            true,
            false,
            30,
            ["stun-1"],
            [],
            "sig-1",
        );
        expect(LinkedDevices.isUsingOnlineServices(device)).toBe(true);
    });

    it("returns true when the signaling server is the online-services sentinel", () => {
        const device = new LinkedDevice(
            "n",
            "s",
            "remote-key",
            "remote-kem",
            Date.now(),
            true,
            false,
            30,
            ["stun-1"],
            ["turn-1"],
            ONLINE_SERVICES_SELECTION_ID,
        );
        expect(LinkedDevices.isUsingOnlineServices(device)).toBe(true);
    });

    it("returns false when STUN/TURN/Signaling are all custom", () => {
        const device = new LinkedDevice(
            "n",
            "s",
            "remote-key",
            "remote-kem",
            Date.now(),
            true,
            false,
            30,
            ["stun-1"],
            ["turn-1"],
            "custom-sig",
        );
        expect(LinkedDevices.isUsingOnlineServices(device)).toBe(false);
    });
});

describe("OnlineServices class", () => {
    it("stores constructor arguments", () => {
        const os = new OnlineServices(
            "device-id",
            "user-id",
            "pub",
            "priv",
            true,
        );
        expect(os.DeviceId).toBe("device-id");
        expect(os.UserID).toBe("user-id");
        expect(os.PublicKeyJWK).toBe("pub");
        expect(os.PrivateKeyJWK).toBe("priv");
        expect(os.IsRootDevice).toBe(true);
    });

    it("defaults IsRootDevice to false", () => {
        const os = new OnlineServices("d", "u", "pub", "priv");
        expect(os.IsRootDevice).toBe(false);
    });

    it("allows direct property assignment (setters via plain fields)", () => {
        const os = new OnlineServices("d", "u", "pub", "priv");
        os.DeviceId = "new-d";
        os.UserID = "new-u";
        os.PublicKeyJWK = "new-pub";
        os.PrivateKeyJWK = "new-priv";
        os.IsRootDevice = true;
        expect(os).toMatchObject({
            DeviceId: "new-d",
            UserID: "new-u",
            PublicKeyJWK: "new-pub",
            PrivateKeyJWK: "new-priv",
            IsRootDevice: true,
        });
    });
});

describe("Server configuration constructors", () => {
    it("STUNServerConfiguration sets fields and a fresh ULID", () => {
        const stun = new STUNServerConfiguration("name", "stun:host");
        expect(stun.Name).toBe("name");
        expect(stun.Host).toBe("stun:host");
        expect(stun.Version).toBe(1);
        expect(stun.ID).toMatch(/^[0-9A-Z]{26}$/);
    });

    it("STUNServerConfiguration defaults to empty strings", () => {
        const stun = new STUNServerConfiguration();
        expect(stun.Name).toBe("");
        expect(stun.Host).toBe("");
    });

    it("TURNServerConfiguration sets fields and a fresh ULID", () => {
        const turn = new TURNServerConfiguration("name", "turn:host", "u", "p");
        expect(turn.Name).toBe("name");
        expect(turn.Host).toBe("turn:host");
        expect(turn.Username).toBe("u");
        expect(turn.Password).toBe("p");
        expect(turn.Version).toBe(1);
        expect(turn.ID).toMatch(/^[0-9A-Z]{26}$/);
    });

    it("SignalingServerConfiguration sets fields and a fresh ULID", () => {
        const sig = new SignalingServerConfiguration(
            "name",
            "app",
            "key",
            "secret",
            "host",
            "80",
            "443",
        );
        expect(sig.Name).toBe("name");
        expect(sig.AppID).toBe("app");
        expect(sig.Key).toBe("key");
        expect(sig.Secret).toBe("secret");
        expect(sig.Host).toBe("host");
        expect(sig.ServicePort).toBe("80");
        expect(sig.SecureServicePort).toBe("443");
        expect(sig.Version).toBe(1);
        expect(sig.ID).toMatch(/^[0-9A-Z]{26}$/);
    });
});

describe("CredentialFormSchema zod parsing", () => {
    it("parses a valid credential form", () => {
        const result = CredentialFormSchema.safeParse({
            ID: null,
            Type: ItemType.Credentials,
            GroupID: "group-1",
            Name: "Login",
            Username: "u",
            Password: "p",
            URL: "",
            Notes: "",
            CustomFields: [
                {
                    ID: "c1",
                    Name: "field",
                    Type: CustomFieldType.Text,
                    Value: "v",
                },
            ],
        });
        expect(result.success).toBe(true);
    });

    it("rejects when Name is empty", () => {
        const result = CredentialFormSchema.safeParse({
            ID: null,
            Type: ItemType.Credentials,
            GroupID: "g",
            Name: "",
            Username: "u",
            Password: "p",
            URL: "",
            Notes: "",
            CustomFields: [],
        });
        expect(result.success).toBe(false);
    });

    it("rejects when Name exceeds the 255-character limit", () => {
        const result = CredentialFormSchema.safeParse({
            ID: null,
            Type: ItemType.Credentials,
            GroupID: "g",
            Name: "x".repeat(256),
            Username: "u",
            Password: "p",
            URL: "",
            Notes: "",
            CustomFields: [],
        });
        expect(result.success).toBe(false);
    });

    it("rejects an unknown ItemType", () => {
        const result = CredentialFormSchema.safeParse({
            ID: null,
            Type: 9999,
            GroupID: "g",
            Name: "n",
            Username: "u",
            Password: "p",
            URL: "",
            Notes: "",
            CustomFields: [],
        });
        expect(result.success).toBe(false);
    });
});
