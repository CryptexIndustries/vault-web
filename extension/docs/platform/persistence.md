# Persistence

## IndexedDB `vaultDB` (`web/src/app_lib/vault-utils/storage.ts`)

| Store      | Contents                                     | Extension access                                     |
| ---------- | -------------------------------------------- | ---------------------------------------------------- |
| `vaults`   | Encrypted vault metadata blobs               | Popup unlock picker, SW vault CRUD, link `saveVault` |
| `keyPairs` | ECDH messaging keys (`keyId`, `status`, JWK) | SW envelope transport                                |

Persistent across browser restarts. Vault blobs remain encrypted at rest; DEK is
**not** stored here.

## IndexedDB `cryptex-backup-staging`

| Store   | Contents                         | Cleared on lock? |
| ------- | -------------------------------- | ---------------- |
| `blobs` | One-shot encrypted `.cryx` bytes | Yes              |

Shared by the service worker (put/clear) and the popup (take). Each create
replaces any previous row. The envelope never carries backup bytes; it carries
a UUID `stagingId`. Take is read-and-delete. Lock and idle clear the store.

## IndexedDB `vaultKeyStore`

| Store                 | Contents              | Cleared on lock?                |
| --------------------- | --------------------- | ------------------------------- |
| `deviceSecondFactors` | Device-bound 2FA keys | Yes (`clearDeviceSecondFactor`) |

Extension vaults with non-`NONE` primary factor cannot unlock DEK
(`EXTENSION_2FA_UNSUPPORTED`).

## `chrome.storage.session`

Memory-backed. Cleared on browser shutdown, `Lock`, system idle, or explicit
`session.clear()`.

| Key               | Owner                                | Contents                                                     |
| ----------------- | ------------------------------------ | ------------------------------------------------------------ |
| `UV`              | `background.ts`                      | Full decrypted `Vault` protobuf                              |
| `UVM`             | `background.ts`                      | Base64-encoded vault metadata                                |
| `AVI`             | `background.ts`                      | Active vault DB index                                        |
| `SESSION_DEK:{n}` | `session-dek-store.ts`               | Raw vault DEK (base64); `TRUSTED_CONTEXTS`                   |
| `OS_SESSION`      | `online-services-session-storage.ts` | JWT, expiry, deviceId, privateKeyJWK                         |
| `PENDING_SAVE`    | `autofill-router.ts`                 | Captured login incl. password (5 min TTL)                    |
| `DRAFT_SAVE`      | `credential-draft-store.ts`          | In-flight credential form draft (mode, form data, stashedAt) |

`UV` is the highest-sensitivity session key: all credential secrets while
unlocked.

`DRAFT_SAVE` is the in-flight credential form draft: SW-owned and session-scoped.
While the popup's form is open and dirty, the popup stashes the current form
values here 500 ms after the last change; on the next popup open the SW
validates the draft against the live unlocked vault (stale edit drafts — the
credential was deleted or its version changed while the popup was closed — are
dropped) and re-presents the form pre-filled. The draft is cleared on
successful save, explicit discard, vault lock / idle lock, and browser
shutdown. The draft stores the form data exactly as typed and may be
incomplete (e.g. password filled, name empty) - completeness is validated
only at submit time.

## `chrome.storage.local`

| Key                                      | Owner                          | Contents                                    |
| ---------------------------------------- | ------------------------------ | ------------------------------------------- |
| `extLogs`                                | `ext-logging.ts`               | Up to 2000 diagnostic log entries           |
| `cryptex:local-backup-receipt:{vaultId}` | `background/backup-service.ts` | DEK-authenticated last-local-backup receipt |

Survives browser restart and vault lock. Receipts are AES-GCM sealed with the
session DEK and vault-id AAD (`web/src/app_lib/backup-status.ts`). Stored
strings longer than 512 characters, corrupt boxes, and forged input all open as
`null`. They hold a timestamp and a SHA-256 fingerprint of the session blob -
not vault plaintext. Lock does not delete them.

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
`chrome.storage.local` or `localStorage`. Local backup receipts in
`chrome.storage.local` are DEK-authenticated metadata, not vault bytes.
