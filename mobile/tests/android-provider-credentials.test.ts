import { expect, it } from "@jest/globals";
import { PasskeyData } from "@cryptex-industries/vault-core/proto";
import {
    TOTP,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { buildAndroidProviderCredentials } from "@/utils/android-provider-credentials";

it("publishes only live provider metadata, preserving order and excluding credential secrets", () => {
    const passkey = Object.assign(new VaultCredential(), {
        ID: "passkey",
        Name: "Example",
        Username: "login",
        Password: "password-secret",
        Notes: "notes-secret",
        TOTP: Object.assign(new TOTP(), { Secret: "totp-secret" }),
        Passkey: PasskeyData.fromPartial({
            RPID: "example.test",
            CredentialID: "credential-id",
            UserName: "passkey-login",
            UserDisplayName: "Display name",
            Discoverable: false,
            PrivateKey: "private-key-secret",
            UserHandle: "user-handle-secret",
        }),
    });
    const deleted = Object.assign(new VaultCredential(), {
        ID: "deleted",
        Deleted: true,
    });
    const password = Object.assign(new VaultCredential(), {
        ID: "password",
        Name: "Password",
        Username: "",
    });
    Object.freeze(passkey.Passkey);
    Object.freeze(passkey);
    Object.freeze(password);
    const rows = buildAndroidProviderCredentials(
        Object.freeze([passkey, deleted, password]),
    );
    expect(rows).toEqual([
        {
            vaultId: "passkey",
            name: "Example",
            username: "login",
            rpId: "example.test",
            passkeyCredentialId: "credential-id",
            passkeyDiscoverable: false,
            passkeyUsername: "passkey-login",
            passkeyDisplayName: "Display name",
        },
        {
            vaultId: "password",
            name: "Password",
            username: undefined,
            rpId: undefined,
            passkeyCredentialId: undefined,
            passkeyDiscoverable: undefined,
            passkeyUsername: undefined,
            passkeyDisplayName: undefined,
        },
    ]);
    for (const secret of [
        "password-secret",
        "notes-secret",
        "totp-secret",
        "private-key-secret",
        "user-handle-secret",
    ]) {
        expect(JSON.stringify(rows)).not.toContain(secret);
    }
    rows[0].name = "Native copy";
    expect(passkey.Name).toBe("Example");
});
