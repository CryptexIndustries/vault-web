# Persistence

## IndexedDB `vaultDB` (`web/src/app_lib/vault-utils/storage.ts`)

| Store      | Contents                                     | Extension access                                     |
| ---------- | -------------------------------------------- | ---------------------------------------------------- |
| `vaults`   | Encrypted vault metadata blobs               | Popup unlock picker, SW vault CRUD, link `saveVault` |
| `keyPairs` | ECDH messaging keys (`keyId`, `status`, JWK) | SW envelope transport                                |

Persistent across browser restarts. Vault blobs remain encrypted at rest; DEK is
**not** stored here.

## IndexedDB `vaultKeyStore`

| Store                 | Contents              | Cleared on lock?                |
| --------------------- | --------------------- | ------------------------------- |
| `deviceSecondFactors` | Device-bound 2FA keys | Yes (`clearDeviceSecondFactor`) |

Extension vaults with non-`NONE` primary factor cannot unlock DEK
(`EXTENSION_2FA_UNSUPPORTED`).

## `chrome.storage.session`

Memory-backed. Cleared on browser shutdown, `Lock`, system idle, or explicit
`session.clear()`.

| Key               | Owner                                | Contents                                   |
| ----------------- | ------------------------------------ | ------------------------------------------ |
| `UV`              | `background.ts`                      | Full decrypted `Vault` protobuf            |
| `UVM`             | `background.ts`                      | Base64-encoded vault metadata              |
| `AVI`             | `background.ts`                      | Active vault DB index                      |
| `SESSION_DEK:{n}` | `session-dek-store.ts`               | Raw vault DEK (base64); `TRUSTED_CONTEXTS` |
| `OS_SESSION`      | `online-services-session-storage.ts` | JWT, expiry, deviceId, privateKeyJWK       |
| `PENDING_SAVE`    | `autofill-router.ts`                 | Captured login incl. password (5 min TTL)  |

`UV` is the highest-sensitivity session key: all credential secrets while
unlocked.

## `chrome.storage.local`

| Key       | Owner            | Contents                          |
| --------- | ---------------- | --------------------------------- |
| `extLogs` | `ext-logging.ts` | Up to 2000 diagnostic log entries |

Only `chrome.storage.local` usage in extension source. Survives browser restart.

## `localStorage`

| Key                             | Owner              | Contents                  |
| ------------------------------- | ------------------ | ------------------------- |
| `extension-last-selected-vault` | `popup-unlock.tsx` | Vault DB index preference |

Non-secret metadata only.

## In-memory (non-persistent)

| Location                  | Contents                        | Lifetime                           |
| ------------------------- | ------------------------------- | ---------------------------------- |
| SW nonce cache            | `origin:requestId` replay guard | 10 min TTL; lost on SW eviction    |
| SW autofill bootstrap map | mountId → nonce registry        | 2 min TTL; single-use claim        |
| CS icon handles           | DOM references                  | Page navigation                    |
| CS last-filled creds      | Fill state                      | Page navigation                    |
| Client session key cache  | `requestId` → derived AES key   | Per-request; deleted after decrypt |
| React state (popup)       | Full credentials in VaultView   | Until lock or popup close          |

## Boundary rule

Encrypted vault blobs live in IndexedDB. Decrypted vault and DEK live only in
`chrome.storage.session` while unlocked. Never persist plaintext credentials to
`chrome.storage.local` or `localStorage`.
