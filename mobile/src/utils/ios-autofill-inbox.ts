import { MMKV, Mode } from "react-native-mmkv";

import { isCredentialUrlRuleValid } from "@cryptex-industries/vault-core/credential-url";
import { base64ToUint8 } from "@cryptex-industries/vault-core/encoding";
import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import {
    createCredential,
    CredentialFormSchema,
    updateCredentialFromForm,
    Vault,
    type CredentialFormSchemaType,
    type VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { appendAutofillAssociation } from "@/utils/android-autofill";
import { iosCredentials } from "@/utils/ios-credentials";
import { vaultLog } from "@/utils/logging";
import {
    captureVaultSession,
    getVaultDEKFromSession,
    isVaultSessionCurrent,
} from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";

/** The App Group store the AutoFill extension writes saved logins to (SharedVault.swift). */
export type InboxStore = Pick<MMKV, "getAllKeys" | "getString" | "delete">;

const ENTRY_PREFIX = "entry:";

const iosInbox: InboxStore | null = iosCredentials?.appGroup
    ? new MMKV({ id: "cryptex-autofill-inbox", mode: Mode.MULTI_PROCESS })
    : null;

/** InboxEntry in targets/autofill/Core/AutofillInbox.swift. */
type InboxEntry = {
    id: string;
    vaultIndex: number;
    createdAt: number;
    iv: string;
    ciphertext: string;
};

/** InboxLogin in targets/autofill/Core/AutofillInbox.swift, the decrypted part. */
type InboxLogin =
    | {
          decision: "new" | "update";
          targetId: string | null;
          /** Checked against CredentialFormSchema, as the app's editor saves. */
          credential: CredentialFormSchemaType;
      }
    | {
          decision: "associate";
          targetId: string;
          credential: { URL: string };
      };

export type InboxMergeResult = {
    added: number;
    updated: number;
    /** Updates of a login deleted since, saved as new logins instead. */
    savedAsNew: number;
    /** Websites added to logins that were filled on them. */
    associated: number;
    failed: number;
};

const isString = (value: unknown): value is string => typeof value === "string";

function parseEntry(json: string | undefined): InboxEntry | null {
    try {
        const entry = JSON.parse(json ?? "") as Partial<InboxEntry>;
        return isString(entry.id) &&
            Number.isSafeInteger(entry.vaultIndex) &&
            Number.isFinite(entry.createdAt) &&
            isString(entry.iv) &&
            isString(entry.ciphertext)
            ? (entry as InboxEntry)
            : null;
    } catch {
        return null;
    }
}

function parseLogin(json: string): InboxLogin | null {
    const login = JSON.parse(json) as {
        decision?: unknown;
        targetId?: unknown;
        credential?: Record<string, unknown>;
    };
    if (login.decision === "associate") {
        const url = login.credential?.URL;
        return isString(login.targetId) &&
            isString(url) &&
            isCredentialUrlRuleValid({
                URL: url,
                MatchMode: CredentialURLMatchMode.ExactHost,
            })
            ? {
                  decision: "associate",
                  targetId: login.targetId,
                  credential: { URL: url },
              }
            : null;
    }
    if (
        login.decision !== "new" &&
        !(login.decision === "update" && isString(login.targetId))
    )
        return null;
    const form = CredentialFormSchema.safeParse({
        ...login.credential,
        ID: null,
        Type: ItemType.Credentials,
        Passkey: null,
        SSHKey: null,
    });
    return form.success
        ? {
              decision: login.decision,
              targetId: isString(login.targetId) ? login.targetId : null,
              credential: form.data,
          }
        : null;
}

async function openEntry(
    entry: InboxEntry,
    dek: CryptoKey,
): Promise<InboxLogin | null> {
    let plaintext: Uint8Array | null = null;
    try {
        plaintext = new Uint8Array(
            await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: base64ToUint8(entry.iv) as Uint8Array<ArrayBuffer>,
                    // Binds the entry to its vault and ID, as the extension sealed it.
                    additionalData: new TextEncoder().encode(
                        `cryptex-autofill-inbox/v1|${entry.vaultIndex}|${entry.id}`,
                    ),
                },
                dek,
                base64ToUint8(entry.ciphertext) as Uint8Array<ArrayBuffer>,
            ),
        );
        return parseLogin(new TextDecoder().decode(plaintext));
    } catch {
        return null;
    } finally {
        plaintext?.fill(0);
    }
}

function vaultEntries(inbox: InboxStore, vaultDbIndex: number): InboxEntry[] {
    return inbox
        .getAllKeys()
        .filter((key) => key.startsWith(ENTRY_PREFIX))
        .flatMap((key) => {
            const entry = parseEntry(inbox.getString(key));
            if (!entry)
                vaultLog.warn("Unreadable iOS AutoFill inbox entry kept", {
                    key,
                });
            return entry?.vaultIndex === vaultDbIndex ? [entry] : [];
        });
}

/** Deletes a deleted vault's entries. They are ciphertext only. */
export function clearIosAutofillInbox(
    vaultDbIndex: number,
    inbox: InboxStore | null = iosInbox,
): void {
    if (!inbox) return;
    for (const { id } of vaultEntries(inbox, vaultDbIndex))
        inbox.delete(ENTRY_PREFIX + id);
}

/**
 * Keeps the AutoFill extension from saving logins while the app rotates a
 * vault's data key. Hold it from merging the inbox until the rotated vault is
 * stored, then call the returned function. The extension saves under the same
 * lock, and only while its key still opens the stored vault. Null without the
 * extension.
 */
export async function lockIosAutofillInbox(): Promise<(() => void) | null> {
    const native = iosCredentials;
    if (!native?.appGroup) return null;
    await native.lockAutofillInbox();
    return () => native.unlockAutofillInbox();
}

const merges = new Map<number, Promise<unknown>>();

/**
 * Adds the logins the AutoFill extension saved for this vault, oldest first,
 * then deletes their entries. A new login takes its entry's ID and an update
 * that is already applied is skipped, so a rerun after a crash between saving
 * the vault and deleting the entries adds nothing twice. Entries that don't
 * open are counted and kept. Returns null when there is nothing to add. Throws
 * when the session ended or the vault couldn't be saved, keeping the entries.
 * Merges of one vault run one at a time, so a later one can't apply an entry
 * an earlier one already applied.
 */
export function mergeIosAutofillInbox(
    vaultDbIndex: number,
    inbox: InboxStore | null = iosInbox,
): Promise<InboxMergeResult | null> {
    const merge = (merges.get(vaultDbIndex) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => mergeInbox(vaultDbIndex, inbox));
    merges.set(vaultDbIndex, merge);
    return merge;
}

async function mergeInbox(
    vaultDbIndex: number,
    inbox: InboxStore | null,
): Promise<InboxMergeResult | null> {
    if (!inbox) return null;
    const session = captureVaultSession();
    const entries = vaultEntries(inbox, vaultDbIndex).sort(
        (left, right) => left.createdAt - right.createdAt,
    );
    if (!entries.length) return null;
    const dek = getVaultDEKFromSession();
    if (dek.isErr()) throw new Error(dek.error);

    const opened: { entry: InboxEntry; login: InboxLogin }[] = [];
    let failed = 0;
    for (const entry of entries) {
        const login = await openEntry(entry, dek.value);
        if (!isVaultSessionCurrent(session))
            throw new Error("VAULT_SESSION_CHANGED");
        if (login) opened.push({ entry, login });
        else {
            failed += 1;
            vaultLog.warn("Could not add a login saved by iOS AutoFill", {
                entryId: entry.id,
            });
        }
    }
    if (!opened.length)
        return { added: 0, updated: 0, savedAsNew: 0, associated: 0, failed };

    const result = await persistVaultMutation(
        "credential.upsert",
        async (current) => {
            let credentials: VaultCredential[] = current.Credentials;
            const done: string[] = [];
            let added = 0;
            let updated = 0;
            let savedAsNew = 0;
            let associated = 0;
            // The entry's ID lets a second run find the login it added.
            const addOnce = async (
                entry: InboxEntry,
                form: CredentialFormSchemaType,
            ) => {
                if (credentials.some(({ ID }) => ID === entry.id)) return false;
                const directoryExists = current.Directories.some(
                    ({ ID, Deleted }) => ID === form.DirectoryID && !Deleted,
                );
                credentials = [
                    ...credentials,
                    await createCredential({
                        ...form,
                        ID: entry.id,
                        // The directory may have been deleted since.
                        DirectoryID: directoryExists ? form.DirectoryID : "",
                    }),
                ];
                return true;
            };
            const replace = (saved: VaultCredential) => {
                credentials = credentials.map((credential) =>
                    credential.ID === saved.ID ? saved : credential,
                );
            };
            for (const { entry, login } of opened) {
                // Only entries still in the inbox, in case another merge
                // applied this one while it was decrypted.
                if (inbox.getString(ENTRY_PREFIX + entry.id) === undefined)
                    continue;
                done.push(entry.id);
                if (login.decision === "new") {
                    if (await addOnce(entry, login.credential)) added += 1;
                    continue;
                }
                const target = credentials.find(
                    ({ ID, Deleted }) => ID === login.targetId && !Deleted,
                );
                if (login.decision === "associate") {
                    // A deleted login has nothing left to associate.
                    if (!target) continue;
                    const AdditionalURLs = appendAutofillAssociation(
                        target,
                        login.credential.URL,
                    );
                    if (AdditionalURLs !== target.AdditionalURLs) {
                        replace(
                            await updateCredentialFromForm(target, {
                                ...target,
                                AdditionalURLs,
                            }),
                        );
                        associated += 1;
                    }
                    continue;
                }
                // The extension stores the save rules' name and URL for this case too.
                if (!target) {
                    if (await addOnce(entry, login.credential)) savedAsNew += 1;
                    continue;
                }
                const { Username, Password } = login.credential;
                if (
                    target.Username !== Username ||
                    target.Password !== Password
                ) {
                    replace(
                        await updateCredentialFromForm(target, {
                            ...target,
                            Username,
                            Password,
                        }),
                    );
                    updated += 1;
                }
            }
            const next = Object.assign(new Vault(), current);
            next.Credentials = credentials;
            return {
                vault: next,
                result: { done, added, updated, savedAsNew, associated },
            };
        },
    );
    if (result.isErr()) throw new Error(result.error);

    const { done, ...counts } = result.value;
    for (const id of done) inbox.delete(ENTRY_PREFIX + id);
    return { ...counts, failed };
}
