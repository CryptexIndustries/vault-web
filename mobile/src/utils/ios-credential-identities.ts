import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import { isSecureDekEnrolled } from "@/lib/secure-dek";
import { iosCredentials, type IosIdentityLogin } from "@/utils/ios-credentials";
import { vaultLog } from "@/utils/logging";

/**
 * What the iOS module needs to build a vault's AutoFill identities, in the
 * same Swift as the extension's setup screen: never a password or TOTP
 * secret, and nothing for deleted logins or SSH keys.
 */
export function iosIdentityLogins(
    credentials: readonly VaultCredential[],
): IosIdentityLogin[] {
    return credentials
        .filter(
            (credential) =>
                !credential.Deleted && credential.Type !== ItemType.SSHKey,
        )
        .map((credential) => ({
            id: credential.ID,
            name: credential.Name,
            username: credential.Username,
            hasPassword: !!credential.Password,
            hasTotp: !!credential.TOTP?.Secret,
            urls: [
                {
                    url: credential.URL,
                    matchMode:
                        credential.URLMatchMode ??
                        CredentialURLMatchMode.ExactHost,
                },
                ...(credential.AdditionalURLs ?? []).map((rule) => ({
                    url: rule.URL,
                    matchMode: rule.MatchMode,
                })),
            ],
        }));
}

const PENDING_CLEARS_KEY = "cryptex:ios-autofill-pending-clears";

let updates: Promise<void> = Promise.resolve();

/** Runs store updates in call order, so a later clear always wins. */
function enqueue(update: () => Promise<void>): Promise<void> {
    updates = updates.then(update).catch(() => {
        vaultLog.warn("Could not update iOS AutoFill suggestions");
    });
    return updates;
}

async function pendingClears(): Promise<number[]> {
    return JSON.parse(
        (await AsyncStorage.getItem(PENDING_CLEARS_KEY)) ?? "[]",
    ) as number[];
}

async function setPendingClears(vaultDbIndexes: number[]): Promise<void> {
    await AsyncStorage.setItem(
        PENDING_CLEARS_KEY,
        JSON.stringify([...new Set(vaultDbIndexes)]),
    );
}

/**
 * Keeps the vault in the pending list until iOS confirms the clear, so a failed
 * or interrupted clear is retried. Only the queue calls it, so list updates
 * don't race.
 */
async function clear(
    native: NonNullable<typeof iosCredentials>,
    vaultDbIndex: number,
): Promise<void> {
    await setPendingClears([...(await pendingClears()), vaultDbIndex]);
    await native.clearVaultIdentities(vaultDbIndex);
    await setPendingClears(
        (await pendingClears()).filter((index) => index !== vaultDbIndex),
    );
}

/**
 * Registers a vault's logins with iOS while it has Face ID unlock turned on,
 * since the extension can only open those vaults, and removes them otherwise.
 */
export function syncIosCredentialIdentities(
    vaultDbIndex: number,
    credentials: readonly VaultCredential[],
): Promise<void> {
    const native = iosCredentials;
    if (!native) return Promise.resolve();
    const logins = iosIdentityLogins(credentials);
    return enqueue(async () => {
        if (!(await isSecureDekEnrolled(vaultDbIndex)))
            return clear(native, vaultDbIndex);
        // A clear that didn't finish goes first, so a later retry can't
        // remove these logins. Until it's confirmed, nothing is registered.
        if ((await pendingClears()).includes(vaultDbIndex))
            await clear(native, vaultDbIndex);
        await native.replaceVaultIdentities(vaultDbIndex, logins);
    });
}

export function clearIosCredentialIdentities(
    vaultDbIndex: number,
): Promise<void> {
    const native = iosCredentials;
    if (!native) return Promise.resolve();
    return enqueue(() => clear(native, vaultDbIndex));
}

/** Retries the clears that iOS hasn't confirmed. */
export function retryIosCredentialIdentityClears(): Promise<void> {
    const native = iosCredentials;
    if (!native) return Promise.resolve();
    return enqueue(async () => {
        for (const vaultDbIndex of await pendingClears())
            await clear(native, vaultDbIndex);
    });
}
