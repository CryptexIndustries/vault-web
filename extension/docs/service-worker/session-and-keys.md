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
2. `metadata.decryptVault(masterPassword)` → decrypted `Vault` protobuf.
3. `setSessionDEKFromVaultMetadata`:
    - Opens primary envelope slot (extractable DEK).
    - Rejects vaults with `PrimaryFactorKind !== NONE` → `EXTENSION_2FA_UNSUPPORTED`.
    - Stores raw DEK in session storage.
4. `setVaultInSessionStorage` writes `UVM`, `UV`, `AVI`.
5. Fire-and-forget `ensureOnlineServicesSessionFromUnlockedVault()` seeds JWT
   from `vault.OnlineServices` when present.

Master password travels inside the encrypted envelope ciphertext, not in
plaintext on the wire.

## Lock and idle teardown

Triggered by:

- `MessageType.Lock`
- `chrome.idle` after 30 minutes of **system** idle (not popup-close alone)
- `clearSessionStorage()`

Actions:

- `clearSessionDEK(vaultDbIndex)` and `clearAllVaultKeyMaterial()`
- `chrome.storage.session.clear()` (vault, metadata, OS session, pending save)
- `clearOnlineServicesSessionInSW()`
- `clearDeviceSecondFactor()` (IndexedDB `vaultKeyStore`)

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
