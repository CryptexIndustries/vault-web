# Extension UI Surfaces

Extension pages run at `chrome-extension://` with CSP
`script-src 'self' 'wasm-unsafe-eval'`. They are not web-accessible to host
pages.

## Surfaces

| Surface         | Entry                          | Privilege     | SW origin                  | ACL                             |
| --------------- | ------------------------------ | ------------- | -------------------------- | ------------------------------- |
| Action popup    | `popup.html` → `popup.tsx`     | High          | `popup`                    | Full vault + sync + proxy       |
| Full-page vault | `popup.html?view=tab`          | High          | `popup`                    | Full vault + sync + proxy       |
| Vault dashboard | `vault-view.tsx` (popup child) | High          | `popup`                    | Same                            |
| Unlock form     | `popup-unlock.tsx`             | High          | via parent                 | Unlock only                     |
| Save prompt     | `popup-save-credential.tsx`    | High / Medium | `popup` or `autofill-save` | List, create/attach + consume   |
| Link tab        | `link.html` → `link.tsx`       | Medium-high   | `link`                     | Proxy + OS establish/clear only |

Manifest: `action.default_popup` → `/popup.html`.

The popup's open-in-tab action launches `popup.html?view=tab`. It uses the same
state machine and SW ACL, with CSS expanding the dashboard to the browser
viewport.

## Popup state machine

```
loading
  → no vault (link CTA)
  → locked (PopupUnlock)
  → unlocked + pending save (PopupSaveCredential)
  → unlocked (VaultView)
```

`popup.tsx` orchestrates unlock/lock via encrypted SW messages. Vault metadata
for the picker is read from Dexie locally; decryption is delegated to SW.

## Sensitive operations

### PopupUnlock

- Lists vaults from IndexedDB (encrypted blobs only).
- Remembers last selection in `localStorage` (`extension-last-selected-vault`) —
  DB index only, not secret.
- Submits master password inside encrypted `Unlock` envelope.

### VaultView

| Operation        | SW message                                     | Exposure                                                       |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| List credentials | `GetCredentials`                               | LiteCredential (no secrets)                                    |
| View detail      | `GetCredential`                                | Full password + TOTP secret in React state                     |
| CRUD             | Create/Update/Delete                           | Full form secrets                                              |
| Sync             | Sync\* messages                                | Credentials cross-device via WebRTC                            |
| Copy fields      | `navigator.clipboard.writeText`                | Clipboard                                                      |
| Backup Center    | `CreateEncryptedBackup`, `GetBackupContext`    | Staged `.cryx` in IndexedDB then popup memory; DEK stays in SW |
| Vault Settings   | `GetVaultSecurity`, security mutation messages | Password/phrase travel encrypted; DEK and vault remain in SW   |
| Open URL         | `window.open(url, "_blank")`                   | New tab — see threat model                                     |
| Lock             | `Lock`                                         | Clears SW session                                              |

### PopupSaveCredential

- Pre-filled from `PENDING_SAVE` (password in React state until consumed).
- For passkeys, lists non-passkey login credentials so the user can create a
  standalone item or attach the passkey to an existing login. The existing-login
  picker prioritizes current-site matches, searches names/usernames/URL rules,
  and renders at most six results so large vaults do not expand the prompt.
- `CreateCredential` persists a new item; `AttachPasskey` performs the narrow
  existing-login update without returning its password to the save UI.
- `ConsumePendingSavePrompt` clears the stash and badge.
- Also embedded in `autofill-save.html` with `autofill-save` origin and frame
  bootstrap nonce.

### Backup Center (`popup-backup-dialog.tsx`)

Opened from Vault actions. The SW serializes an encrypted `.cryx`; the popup
never receives the DEK.

| Operation                              | Path                                                            | Exposure                                                  |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Local download                         | `CreateEncryptedBackup` with receipt; popup takes staged blob   | Ciphertext in IndexedDB then popup, then Downloads        |
| Managed list / enable / pause / delete | tRPC `v1.backup.*` via `ProxyFetch`                             | Snapshot metadata; enable/delete are root-only on the API |
| Managed upload / cloud download        | tRPC intent, then native `fetch` of the signed object-store URL | Ciphertext on the wire to the object store; no JWT        |

Restore and Recovery Kit flows are web-only. A local receipt records that Cryptex
initiated a download; it cannot prove the file still exists.

### Vault Settings (`popup-vault-security-dialog.tsx`)

Opened from Vault actions and intentionally limited to **Encryption &
Security**. It matches the web controls for master-password changes, generated
128/256-bit protection phrases, recovery-code rotation, optional local DEK
rotation, and managed-backup replacement/history deletion. All opt-in rotation
and deletion checkboxes default off. Managed-history deletion is account-wide,
including older linked-device snapshots, because the backup API does not expose
a stable per-device/vault filter.

WebAuthn PRF is deliberately omitted. Existing PRF-protected vaults show an
unsupported notice and must be changed in the web app. One-time protection
phrases and recovery codes block dialog dismissal until acknowledged.

### Link tab (`popup-receive-link.tsx`)

Stages: `input` → `linking` → `passphrase` → `done` | `failed` | `aborted`

| Stage      | Secrets in memory                                   |
| ---------- | --------------------------------------------------- |
| Input      | Mnemonic, QR/file package                           |
| Linking    | Raw vault bytes, device private key JWK (transient) |
| Passphrase | User-chosen local encryption passphrase             |
| Persist    | `saveVault()` direct to Dexie — **no SW Unlock**    |

Deliberately excluded from link ACL: Unlock, Lock, credential CRUD, sync fetch.

After completion the link tab auto-closes; user must unlock from popup.

## Security choices

| Choice                        | Rationale                                                                   |
| ----------------------------- | --------------------------------------------------------------------------- |
| Unlock only in popup          | User gesture context; master password never on link page for existing vault |
| Link in full tab              | QR/camera space; separates high-risk receive from toolbar popup             |
| New passphrase after link     | Receiver sets this device's encryption; sender passphrase not reused        |
| Link SW access minimized      | JWT and API calls stay in SW; link page never holds token                   |
| Save-login prioritizes prompt | Explicit consent before persisting autofill-captured login                  |
| Lite vs full credentials      | List omits secrets; detail fetch is explicit                                |
| Lock clears OS session        | JWT not usable while locked                                                 |
| Backup serialize in SW        | DEK never enters popup; `.cryx` is ciphertext only                          |
| Security mutation in SW       | Popup never receives DEK, derived protection key, or decrypted vault        |
| Signed backup URLs off proxy  | Object-store PUT/GET must not receive the Online Services JWT               |

## SW communication

All privileged UI→SW traffic uses encrypted envelopes via
`sw-envelope-client.ts` / `session-utils.ts`. Plaintext allowed only for
`GetPublicKey`.

Popup and link origins are validated by URL prefix in `security-utils.ts`.
See [service-worker/messaging.md](../service-worker/messaging.md) for full ACL.

## File map

| Path                                             | Role                    |
| ------------------------------------------------ | ----------------------- |
| `popup.html`, `src/popup.tsx`                    | Popup orchestrator      |
| `src/vault-view.tsx`                             | Unlocked dashboard      |
| `src/components/popup-unlock.tsx`                | Vault picker + password |
| `src/components/popup-save-credential.tsx`       | Save-login consent      |
| `src/components/popup-backup-dialog.tsx`         | Backup Center           |
| `src/components/popup-vault-security-dialog.tsx` | Encryption settings     |
| `src/components/popup-receive-link.tsx`          | Link-receive wizard     |
| `src/utils/backup-client.ts`                     | Popup → SW backup RPC   |
| `src/utils/backup-staging.ts`                    | IndexedDB `.cryx` stage |
| `link.html`, `src/link.tsx`                      | Link tab shell          |
| `src/utils/sw-envelope-client.ts`                | Shared SW client        |
| `src/utils/sw-proxy-fetch.ts`                    | tRPC → ProxyFetch shim  |
