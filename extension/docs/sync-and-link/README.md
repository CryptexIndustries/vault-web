# Sync and Link

Sync and device linking reuse shared web code (`web/src/app_lib/`) inside
extension pages. Vault plaintext never leaves the service worker except through
explicit SW message handlers.

## Documents

- [online-services.md](online-services.md) — JWT lifecycle and tRPC proxy

## Sync architecture

**Host:** `vault-view.tsx` when popup is unlocked and `serverPublicKey` is available.

**Controller:** `SyncConnectionController` from `web/src/app_lib/synchronization.ts`.

**Extension bridge (`VaultOperations`):** popup does not hold the vault. It issues
encrypted SW messages:

| Message                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `SyncGetConfiguration`      | `LinkedDevices` (devices, STUN/TURN, sync keys)   |
| `SyncGetItemVersionVectors` | Version vectors for sync hello                    |
| `SyncGetItemCredentials`    | Plaintext credentials by ID (outbound sync)       |
| `SyncUpdateCredentials`     | Merge inbound credentials into vault + re-encrypt |

**Network path:**

1. **Signaling** — Pusher (`initPusherInstance`): custom server from vault config
   or Cryptex Online Services default.
2. **WebRTC** — `RTCPeerConnection` + `RTCDataChannel` in the popup page.
3. **Wire protocol** — `SyncSessionInit` / `SyncSessionAccept` (PQ KEM + signing
   handshake), then `SyncEncryptedMessage` (AEAD). Plaintext wire commands are
   dropped.

**Lifecycle constraint:** sync runs only while popup is open and vault unlocked.
Closing popup tears down `GlobalSyncConnectionController`. Offscreen document is
provisioned (`WEB_RTC` reason) but `offscreen.ts` is a stub — no background sync
yet.

### Extension `VaultOperations` bridge

`createVaultOperations` in `src/vault-operations.ts` implements the full shared
`VaultOperations` interface. Sync key getters read `LinkedDevices` from the SW via
`SyncGetConfiguration`, coalesced through `createCachedSyncConfigLoader` so one `SyncGetConfiguration`
fetch serves the full encrypted sync handshake for that popup session.

| Method                                                 | SW / local source                              |
| ------------------------------------------------------ | ---------------------------------------------- |
| `getSynchronizationConfig`                             | `SyncGetConfiguration` → `vault.LinkedDevices` |
| `getSyncSigningPublicKey` / `getSyncSigningPrivateKey` | cached `LinkedDevices`                         |
| `getSyncKemPublicKey` / `getSyncKemPrivateKey`         | cached `LinkedDevices`                         |
| `getRemoteSyncPublicKey` / `getRemoteSyncKemPublicKey` | cached device entry                            |
| `getItemVersionVectors`                                | `SyncGetItemVersionVectors`                    |
| `getItemCredentials`                                   | `SyncGetItemCredentials`                       |
| `updateCredentials`                                    | `SyncUpdateCredentials`                        |

## Link-receive architecture

**Host:** `link.html` → `popup-receive-link.tsx` (opened from popup via
`chrome.tabs.create`).

**Pipeline:**

1. **Input** — QR base64 or `.cryptex` link file + mnemonic.
2. **Package decrypt** — `LinkingPackage.decryptPackage(mnemonic)` → signaling
   config, STUN/TURN, sender key bundle, optional `OnlineServices` creds.
3. **Online Services bootstrap** (if package includes OS creds):
   `establishOnlineServicesSessionViaSW` → SW passkey challenge/verify → JWT in
   `OS_SESSION`. On failure: warn and continue without OS.
4. **Linking** — `LinkingProcessController` (`web/src/app_lib/vault-utils/linking.ts`):
   Pusher presence channel, WebRTC, sync key exchange, encrypted vault transfer
   (`LinkVaultTransfer` AEAD).
5. **Passphrase** — user sets local Argon2id params;
   `createLinkedVaultEnvelopeBlob()` → `saveVault()` to IndexedDB.
6. **Done** — tab closes; user unlocks from popup.

Mnemonic never crosses the network. Link page cannot call Unlock or read
credentials from SW.

## Trust boundaries

| Boundary                | Controls                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Extension page ↔ SW     | ECDH envelopes, origin ACL, replay protection                                                                             |
| SW ↔ Cryptex API        | tRPC allowlist, JWT injection, `credentials: omit`                                                                        |
| Pusher / WebRTC ↔ peers | Channel auth via proxied tRPC; app-layer AEAD on payloads                                                                 |
| Signaling MITM          | WebRTC identity brokered through signaling; mitigated by PQ KEM + signing handshake on sync/link payloads, not eliminated |

## Data crossing boundaries

| Flow          | In                                   | Out                                           |
| ------------- | ------------------------------------ | --------------------------------------------- |
| Sync read     | item IDs                             | credentials[], version vectors, LinkedDevices |
| Sync write    | full Credential[]                    | `{ ok }`                                      |
| Link transfer | encrypted package + mnemonic (local) | raw vault bytes in receiver memory            |
| Local seal    | user passphrase                      | encrypted blob in IndexedDB                   |
| OS establish  | deviceId, privateKeyJWK              | JWT in SW session storage                     |

## File map

| Path                                               | Role                                    |
| -------------------------------------------------- | --------------------------------------- |
| `src/vault-view.tsx`                               | Sync host UI                            |
| `src/vault-operations.ts`                          | `VaultOperations` bridge + config cache |
| `src/components/popup-receive-link.tsx`            | Link-receive UI                         |
| `src/link.tsx`, `link.html`                        | Link tab entry                          |
| `src/utils/linked-vault-envelope.ts`               | Post-link vault sealing                 |
| `src/utils/online-services-session-client.ts`      | Link/popup → SW OS session              |
| `src/app_lib/online-services-session/extension.ts` | Extension session port adapter          |
| `src/trpc-ext.ts`                                  | Extension tRPC client (proxy only)      |
| `src/utils/sw-proxy-fetch.ts`                      | fetch shim → ProxyFetch                 |
| `web/src/app_lib/online-services-session/`         | Shared session port + auth protocol     |
| `web/src/app_lib/synchronization.ts`               | Sync wire protocol                      |
| `web/src/app_lib/vault-utils/linking.ts`           | Link package + process controller       |
