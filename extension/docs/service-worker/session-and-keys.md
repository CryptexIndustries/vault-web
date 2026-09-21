# Session and Keys

Two separate key systems operate in the extension. Do not conflate them.

## ECDH messaging keys (envelope transport)

| Property | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Purpose  | Encrypt envelopes between extension contexts and SW                                    |
| Storage  | IndexedDB `keyPairs` (`keyId`, `status`, non-extractable `privateKey`, `publicKeyJwk`) |
| Lifetime | Persistent across browser restarts                                                     |
| Rotation | Every 30 days; old key marked `decommission`                                           |

On install/startup: `ensureActiveKeyPair()` if none exists;
`checkAndRotateKeysIfNeeded()` if active key is older than 30 days.

Clients discover rotation via `STALE_KEY` plaintext response and retry with
refreshed public key. No proactive `KEY_ROTATED` broadcast yet.

## Vault DEK (encryption at rest)

| Property     | Value                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| Purpose      | AES-GCM-256 key for vault blob encryption                                    |
| Storage      | `chrome.storage.session` key `SESSION_DEK:{vaultDbIndex}` (base64 raw bytes) |
| Access level | `TRUSTED_CONTEXTS` when API available                                        |
| Lifetime     | Cleared on lock, idle, browser shutdown                                      |

Managed by `background/session-dek-store.ts`. Raw DEK bytes are zeroed after
export/import where possible.

## Unlock sequence (`MessageType.Unlock`)

1. Load encrypted metadata from IndexedDB `vaults`.
2. `metadata.decryptVault(masterPassword, protectionPhrase?)` → decrypted
   `Vault` protobuf. A vault with a protection phrase first uses the
   device-local derived key. The saved phrase repopulates that cache after a
   restore or cleared profile data.
3. `setSessionDEKFromVaultMetadata`:
    - Opens primary envelope slot (extractable DEK).
    - Supports `NONE`, `PROTECTION_PHRASE_128`, and `PROTECTION_PHRASE_256`.
    - Rejects `WEBAUTHN_PRF` as `EXTENSION_WEBAUTHN_UNSUPPORTED`.
    - Stores raw DEK in session storage.
4. `setVaultInSessionStorage` writes `UVM`, `UV`, `AVI`.
5. Fire-and-forget `ensureOnlineServicesSessionFromUnlockedVault()` seeds JWT
   from `vault.OnlineServices` when present.

Master password travels inside the encrypted envelope ciphertext, not in
plaintext on the wire.

## Vault security changes

`GetVaultSecurity`, `ReconfigureVaultSecurity`, and
`RotateVaultRecoveryCode` are popup-only encrypted messages. The popup sends
authorization and choices but never receives the DEK, decrypted vault, or
derived protection key. The service worker runs both mutations through the
shared single-writer queue.

DEK rotation is off by default. When selected, the worker persists a fresh
DEK/IV/ciphertext plus rebuilt primary and recovery slots. After that commit,
it reopens the new primary slot inside the service worker to replace
`SESSION_DEK:{vaultDbIndex}`, then publishes the session metadata. The DEK
returned by the shared rotation code is non-extractable and never crosses into
the popup. The session stays unlocked on success. The one-time response may
contain the new recovery code and protection phrase; the UI blocks dismissal
until the user acknowledges saving them. WebAuthn PRF enrollment and mutation
remain web-app-only.

After the local commit, a vault with an Online Services binding queues a
separate alarm-backed managed backup job. The job checks that managed backups
are enabled, then prepares one consistent encrypted snapshot under the vault
write coordinator. It releases the coordinator before network upload or
old-history deletion. Backup jobs have a separate serial queue, preventing two
replacement-and-purge requests from deleting each other's snapshots. Network
failures are status results of the job and do not change the successful local
mutation.

An interrupted browser session can leave a queued backup or history purge
unfinished. This fails safely by retaining older restore points; the local
security change is not rolled back, and the user can request another backup or
purge after unlocking again.

## Lock and idle teardown

Triggered by:

- `MessageType.Lock`
- `chrome.idle` after 30 minutes of **system** idle (not popup-close alone)
- `clearSessionStorage()`

Actions:

- `clearSessionDEK(vaultDbIndex)` and `clearAllVaultKeyMaterial()`
- `chrome.storage.session.clear()` (vault, metadata, OS session, pending save)
- `clearOnlineServicesSessionInSW()`
- Clear IndexedDB `cryptex-backup-staging` (one-shot `.cryx` blobs)

The protection-phrase key in IndexedDB `vaultKeyStore` deliberately survives
ordinary lock and idle teardown, so same-profile unlock needs only the master
password. Protection changes replace or clear it. Clearing the extension or
profile data removes it.

Local backup receipts in `chrome.storage.local` are not cleared. They are
DEK-authenticated metadata and are unreadable without a later unlock of the
same vault.

## Online Services session (`OS_SESSION`)

Stored in `chrome.storage.session` while active:

- `sessionToken`, `sessionExpiresAt`
- `deviceId`, `privateKeyJWK` (duplicated from vault for SW re-auth without popup)

Lifecycle:

- **Establish** — `OnlineServicesEstablish` (link) or unlock bootstrap
- **Refresh** — 60 s before expiry via `v1.auth.refresh`
- **Re-auth fallbacks** — Stored device creds, then unlocked vault `UV.OnlineServices`
- **Clear** — Lock, idle, link flow without OS package, `OnlineServicesClear`

SW-internal auth client (`auth-session-ext.ts`) uses `globalThis.fetch` directly
for `v1.auth.*` to avoid proxy recursion.

## Plaintext vault in session

While unlocked, `UV` holds the full decrypted vault including all credential
passwords and TOTP secrets. Any compromise of the browser session while
unlocked exposes all vault contents. This is the central trust assumption for
the extension threat model.
