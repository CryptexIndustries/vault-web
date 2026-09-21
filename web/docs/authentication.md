# Authentication

This document explains how authentication and recovery work in the web app.
It focuses on the browser, the UI, and the steps the user actually takes.
It documents the client and checked-in API contract, not private server storage
or deployment internals.

For the server API and authorization details, see
[authentication-api.md](./authentication-api.md).

## A quick distinction

Cryptex has two separate layers:

- The **local vault** contains encrypted vault data and, when the user has
  connected Online Services, the local credentials that let the app sign in
  automatically.
- The **Online Services account** provides hosted synchronization infrastructure, device linking, billing, and managed encrypted backups.

Recovering one does not automatically recover the other. In particular, an
Online Services Recovery Kit phrase does not decrypt a vault, and a vault
recovery code does not recover an Online Services account.

## Terms and secrets

- **Vault**: The encrypted local password vault. It must be unlocked before the
  dashboard and account controls are available.
- **Online Services binding**: The account and device credentials stored inside
  an unlocked vault. It contains a server-issued device ID, the account User
  ID, and a device-signing key pair. The private signing key stays in the
  vault; it is not sent to Online Services auth endpoints.
- **Session**: Short-lived Online Services access held in frontend memory. It
  contains an access session token and a refresh token, and is recreated
  automatically from the vault binding when possible.
- **Root device**: The account device allowed to manage account-level features,
  including Recovery Kits and managed backup setup.
- **Online Services Recovery Kit**: The User ID and a 24-word recovery phrase
  saved together. They recover Online Services access and authorize a fresh
  device to find eligible cloud restore points.
- **Vault recovery code**: A local fallback for unlocking an encrypted vault.
  It is unrelated to the Online Services Recovery Kit.

| Secret                                        | Used for                                          | Where it is used           |
| --------------------------------------------- | ------------------------------------------------- | -------------------------- |
| Vault password                                | Normal local vault unlock                         | Browser only               |
| Vault recovery code                           | Fallback local vault unlock                       | Browser only               |
| Online Services User ID + Recovery Kit phrase | Account recovery and fresh-device backup recovery | Entered in the recovery UI |
| Protection phrase or WebAuthn security key    | Additional local vault key protection             | Browser during unlock      |

A generated protection phrase has two forms on a configured browser profile:
the displayed phrase, which the user must save, and a derived key cached on the
device. Ordinary lock/unlock can use the cached key and ask only for the vault
password. Restoring a backup, clearing site or extension data, or moving the
encrypted vault to a profile without that cache requires the saved protection
phrase again. Neither the phrase nor its derived key syncs to linked devices.

Changing protection normally rewraps the existing vault DEK. The optional
local DEK rotation re-encrypts the vault and necessarily generates a new vault
recovery code. This recovery code remains distinct from the Online Services
Recovery Kit described below.

## What is stored where

### Inside the vault

When Online Services is connected, the serialized `OnlineServices` section of
the vault contains four values:

- `DeviceId`: the server-issued ID for this device
- `UserID`: the Online Services account ID
- `PublicKeyJWK`: the public half of the device-signing key pair
- `PrivateKeyJWK`: the private half, stored inside the encrypted vault

This binding is encrypted with the vault. It is what allows the dashboard to
sign in again after the vault is unlocked without asking for an Online Services
password.

The runtime `OnlineServices` class also exposes `IsRootDevice`. The client
updates it from the latest account configuration as a convenience cache, but it
is not the authorization source and is not part of the serialized protobuf
binding. Use the server-provided configuration for current permissions.

The vault's `LinkedDevices` section is separate. It contains peer/sync
configuration and is not the credential store for the Online Services session.

### In frontend session state

The app keeps the current Online Services session in
`onlineServicesDataAtom` / `onlineServicesStore`. The state contains:

- `deviceId`
- `sessionToken` and `sessionExpiresAt`
- `refreshToken` and `refreshExpiresAt`
- `remoteData`, the server-provided account configuration

This is a module-local memory store. It is not the durable account binding, a
browser cookie, or local vault persistence. Locking the vault clears it; the
binding remains in the encrypted vault unless the user explicitly removes it.

### In account configuration

After a session is established, `user.configuration` hydrates the client with
the current device ID and capability flags, including:

- whether this device is currently `root`
- whether it may link or promote devices, and its `maxLinks` limit
- whether managed encrypted backups and security-report features are available
- whether a Recovery Kit exists and whether a replacement kit is required

These values drive the UI. They are not a second local authorization system;
the service remains authoritative when a protected operation is attempted.

### In managed backup storage

Managed backup storage receives encrypted `.cryx` bytes, not the secrets needed
to unlock them. See [managed-backups.md](./managed-backups.md) for the storage
and transfer details.

## The client-side authentication protocol

The web app does not use an Online Services account password for its normal
sign-in path. It uses possession of a device-signing private key that is
unlocked along with the vault.

### Device-signing key

The browser generates an extractable ECDSA key pair using the Web Crypto API:

- named curve: **P-256**
- signature hash: **SHA-256**
- storage format: JSON Web Key (JWK) strings

The public JWK may cross the Online Services API boundary. The private JWK is
exported once, placed in the `OnlineServices` vault binding, and later imported
by Web Crypto only when the browser needs to sign a challenge. The signing
helper returns a base64url signature in Web Crypto's fixed-width IEEE P1363
format.

### Challenge-response

The login exchange is deliberately split into two requests:

1. `v1.auth.challenge({ deviceId })` returns a `challengeId`, base64-encoded
   challenge bytes, and an expiry timestamp.
2. The browser decodes the challenge bytes and signs the raw bytes with the
   private JWK from the unlocked vault.
3. `v1.auth.verify({ challengeId, signature, deviceId })` exchanges the
   signature for an access `sessionToken`, a `refreshToken`, and the two
   corresponding expiry timestamps.

The challenge ID and signature are not stored in the vault. A successful
exchange produces only the temporary session state described above.

### Contract-level API map

These are the browser-facing operations in the checked-in API contract. The
table describes data crossing the client boundary only.

| Operation                                     | Access    | Browser sends                                    | Browser receives                                     |
| --------------------------------------------- | --------- | ------------------------------------------------ | ---------------------------------------------------- |
| `v1.auth.register`                            | Public    | Public JWK + captcha                             | New `deviceId` + `userId`                            |
| `v1.auth.challenge`                           | Public    | `deviceId`                                       | Challenge ID, bytes, expiry                          |
| `v1.auth.verify`                              | Public    | Challenge ID + signature + `deviceId`            | Access/refresh tokens + expiries                     |
| `v1.auth.refresh`                             | Public    | Current refresh token                            | Rotated access/refresh tokens + expiries             |
| `v1.auth.logout`                              | Protected | Optional current refresh token                   | Success                                              |
| `v1.auth.recover`                             | Public    | User ID + 24 words + new public JWK + captcha    | New `deviceId`                                       |
| `v1.user.configuration`                       | Protected | Bearer session token                             | Root status and account capability flags             |
| `v1.backup.createRecoverySession`             | Public    | User ID + Recovery Kit + captcha + browser token | Recovery-session expiry                              |
| `v1.backup.recoveryList` / `recoveryDownload` | Public    | Recovery-session token + cursor or snapshot ID   | Encrypted restore-point metadata or transfer details |

The public/protected labels here describe whether a bearer session is required
for that contract operation. They do not mean that the operation is
unauthorized in the product sense: captcha, Recovery Kit, root status, and
local-vault secrets are checked by their respective flows.

## Registration

Registration is available from the Account dialog after a vault is unlocked.

1. Open **Account** and choose **Create account**.
2. Complete the captcha.
3. Choose **Register & sign in**.
4. The browser generates a P-256 key pair and sends only the public JWK and
   captcha token to `v1.auth.register`.
5. After receiving the new `deviceId` and `userId`, the browser stores the full
   binding, including the private JWK, in the current vault.
6. The app establishes an Online Services session and loads account
   configuration.
7. The app attempts to create and show a Recovery Kit.

The private key is generated and retained locally. The Recovery Kit is shown
only when it is generated, so the user should download, print, or copy it and
store both the User ID and phrase offline. If the post-registration dialog
cannot be shown, create the kit later from **Account > Security**.

## Normal sign-in

There is no separate password prompt for Online Services when the vault already
contains a valid binding.

When a vault is unlocked:

1. `VaultDashboard` checks for an Online Services binding.
2. If one exists, `establishPremiumSession` requests a challenge for the
   binding's `DeviceId`.
3. The browser decodes and signs the challenge locally with the binding's
   `PrivateKeyJWK`.
4. The browser sends the challenge ID, signature, and device ID to `auth.verify`.
5. The returned access and refresh session data is placed in
   `onlineServicesStore`.
6. The app calls `user.configuration` and refreshes root status and available
   account features.

If the vault has no binding, the dashboard does not create an Online Services
session. The Account action is shown as **Sign up**, and the user can register
or recover an account.

If automatic sign-in fails, the dashboard shows an error and tells the user to
open **Account** to retry. The vault itself is still available locally.

## Session refresh

The standard tRPC client runs a freshness check just before it sends a batch
that contains Online Services traffic. This is a lazy check, not a background
timer: an idle browser does not keep refreshing an account session.

The client considers either token due for attention when its server-provided
expiry is within **60 seconds**. It then tries the following, in order:

1. Continue with the current session if the access and refresh data are still
   outside that window.
2. Call `v1.auth.refresh` with the current refresh token.
3. Replace the access and refresh session data with the returned pair. Refresh
   is a rotation operation from the browser's point of view; the old refresh
   value is not retained as the current one.
4. If refresh fails, sign in again using the unlocked vault's Online Services
   binding and the challenge-response flow.

The refresh result is applied only if the session has not been replaced while
the request was in flight. This prevents an older concurrent refresh from
overwriting a newer session. A shared in-flight runner also makes concurrent
protected calls wait for one refresh or re-authentication attempt instead of
starting several of them. Forced re-authentication requests are additionally
gated for 30 seconds.

If the frontend session's device ID differs from the unlocked vault binding,
the client clears/signs out the old session and starts again from the vault
binding. If the vault is locked, has no binding, or the private key no longer
matches the account device, the automatic fallback cannot succeed. The
preflight does not replay a failed protected request; the caller may receive
an authorization error and the user may need to open **Account** after
unlocking.

## Protected requests and authorization

`createBareAuthHeader` reads the current access session token from
`onlineServicesStore` and sends it as:

```text
Authorization: Bearer <sessionToken>
```

The header is created after the freshness check, so a request sees the latest
token produced by a refresh or re-authentication. Auth bootstrap calls use a
small client dedicated to the `v1.auth` namespace so the freshness hook does
not recursively call itself.

After sign-in, `user.configuration` supplies the account and device state used
by the UI. In particular, `root`, `canLink`, `maxLinks`,
`canPromoteDevices`, `managedEncryptedBackups`, and
`recoveryGenerationNeeded` are server-provided facts, not values inferred from
the vault password or Recovery Kit.

The local `IsRootDevice` field and the `remoteData.root` value are useful for
displaying the current state, but they are not permission grants. A root-only
operation must still be accepted by the Online Services side for the current
session and device.

## Linking another device

Online Services device linking creates another account binding; it does not
copy the current browser session to the peer.

1. The sending device generates a new P-256 key pair for the peer.
2. It sends only the new public JWK through `v1.device.link` and receives a
   new server device ID and a sync relationship ID.
3. The sender places the peer's private JWK and the new device ID in the
   encrypted linking package delivered to the peer.
4. The peer installs that `OnlineServices` payload in its own vault and later
   performs its own challenge-response sign-in.

The private key is therefore transported to the peer as part of the encrypted
linking flow, not as a plaintext auth API field. The peer has a distinct
Online Services device ID and session even though both devices belong to the
same account.

## Recovery overview

There are three different recovery actions in the frontend:

1. **Recover Online Services account in an unlocked vault** - restores account
   control and binds a new local device key pair, but does not restore vault
   contents.
2. **Restore an encrypted vault backup** - creates a local vault from a `.cryx`
   file and then unlocks it with the vault secret.
3. **Restore from a managed backup on a fresh device** - uses the Online
   Services Recovery Kit to find an eligible encrypted restore point, then
   unlocks it locally with the vault secret.

See [managed-backups.md](./managed-backups.md) for the backup requirements,
restore steps, retry behavior, and Recovery Kit lifecycle.

## Recover an Online Services account in an unlocked vault

Use this path when the user has a usable local vault but no working Online
Services binding, or when the existing binding has to be replaced.

### Before starting

The user needs:

- the Online Services **User ID**
- the current **24-word Recovery Kit phrase**
- a working local vault that is unlocked
- a completed captcha

If the current vault still has an Online Services binding, first use
**Account > Security > Remove local binding**. This removes the account
credentials from that vault and signs out locally; it does not delete the
Online Services account.

### Steps

1. Open **Account**.
2. Choose **Recover account**.
3. Enter the User ID.
4. Enter or paste all 24 Recovery Kit words in order.
5. Complete the captcha.
6. Choose **Recover account**.

The browser generates a new local device key pair. After the recovery
operation succeeds, it:

1. stores the new Online Services binding in the current vault
2. establishes a fresh Online Services session
3. refreshes the account configuration
4. reports **Account recovered. Sign-in refreshed.**

### What this path does not do

This path does not reconstruct a lost vault. It only restores Online Services
account access in the vault currently open in the browser. To recover vault
contents, follow the local or managed restore instructions in
[managed-backups.md](./managed-backups.md).

The Recovery Kit used for account recovery is consumed. Existing device access
may need to be set up again, and the user should create and save a new kit from
**Account > Security** before relying on recovery again.

## Backup restoration and authentication

Backup restoration does not bypass either authentication layer. An Online
Services Recovery Kit can authorize access to an eligible managed restore
point, but it cannot decrypt the vault. The vault password or recovery code,
plus any configured additional protection key, is still required locally.

Fresh-device lookup uses a random recovery-session value rather than a normal
bearer session. The value is kept in memory, is never written into the vault,
and is used only with `v1.backup.createRecoverySession`,
`v1.backup.recoveryList`, and `v1.backup.recoveryDownload`.

After a restored vault is unlocked, an embedded Online Services binding can
establish the normal signed-in session. For the complete restore workflow, see
[managed-backups.md](./managed-backups.md).

## Online Services Recovery Kit management

Recovery Kit management is in **Account > Security**.

### Generate a kit

When no kit exists, a root device can choose **Generate recovery package**.
The app shows the User ID and 24-word phrase once in the **Save your Recovery
Kit** dialog. The user can download, print, or copy it, then acknowledge that
it has been saved.

### Rotate a kit

When a kit already exists, **Rotate recovery package** replaces it. The
confirmation explains that:

- every previous Recovery Kit becomes invalid
- any active backup recovery session ends
- the new package must be saved before continuing

There is no clear-only action. The UI offers generation or rotation, not
removal of the recovery capability. Only the root device can perform these
actions.

Anyone who has both the User ID and the current phrase can attempt account or
fresh-device recovery. They should be stored offline and separately from
ordinary browser data where practical.

## Automatic sign-in when a vault opens

When the dashboard loads after an unlock, it compares the session's device ID
with the binding in the vault:

- if they match, the current session is reused
- if they differ, stale session state is cleared and the app signs in from the
  vault binding
- if no binding exists, no Online Services session is created

The same behavior runs after registration, account recovery, and a cloud backup
restore.

## Locking and removing the local binding

### Locking the vault

Locking:

- saves pending local vault changes
- clears the vault decryption key from browser session storage
- attempts `v1.auth.logout` with the current session, then clears Online
  Services state locally even if the network call fails
- clears the unlocked vault state

The encrypted vault and its Online Services binding remain stored locally.

### Removing the local binding

**Account > Security > Remove local binding**:

- attempts the same best-effort Online Services sign-out
- removes the Online Services binding from the current vault
- saves that vault
- leaves the server-side account and its other data intact

Afterward, the user can register a different account or use **Recover account**
with a Recovery Kit.

## User-facing failure cases

- **Automatic sign-in fails**: unlock remains available; open **Account** to
  retry.
- **Recovery phrase is rejected**: verify the User ID and all 24 words, in
  order, then retry. A phrase from an older rotated kit is no longer valid.
- **Session refresh fails**: the app tries a full sign-in from the unlocked
  vault binding. If that binding is missing or invalid, open **Account** after
  unlocking.

## Frontend source map

- Session creation, refresh, fallback re-authentication, and logout:
  [`web/src/app_lib/auth-session.ts`](../src/app_lib/auth-session.ts)
- Shared session freshness before protected tRPC requests:
  [`web/src/utils/trpc.ts`](../src/utils/trpc.ts)
- Session atom shape and in-memory store:
  [`web/src/utils/atoms.ts`](../src/utils/atoms.ts)
- Automatic sign-in and Online Services session startup:
  [`web/src/components/vault-dashboard/vault-dashboard.tsx`](../src/components/vault-dashboard/vault-dashboard.tsx)
- Account registration, account recovery, Recovery Kit generation/rotation,
  and local binding removal:
  [`web/src/components/vault-dashboard/account-dialog/index.tsx`](../src/components/vault-dashboard/account-dialog/index.tsx)
- Account registration/recovery controls:
  [`web/src/components/vault-dashboard/account-dialog/account-auth.tsx`](../src/components/vault-dashboard/account-dialog/account-auth.tsx)
- Recovery phrase entry and normalization:
  [`web/src/components/vault-dashboard/account-dialog/recovery-phrase-input.tsx`](../src/components/vault-dashboard/account-dialog/recovery-phrase-input.tsx)
- Recovery Kit save, download, print, and copy UI:
  [`web/src/components/vault-dashboard/account-dialog/recovery-kit-dialog.tsx`](../src/components/vault-dashboard/account-dialog/recovery-kit-dialog.tsx)
- Local vault unlock and vault recovery-code entry:
  [`web/src/components/vault-manager/unlock.tsx`](../src/components/vault-manager/unlock.tsx)
- Device-signing key generation and challenge signatures:
  [`packages/vault-core/src/vault-utils/device-signing-key.ts`](../../packages/vault-core/src/vault-utils/device-signing-key.ts)
- Vault binding model and serialized Online Services fields:
  [`packages/vault-core/src/vault-utils/vault.ts`](../../packages/vault-core/src/vault-utils/vault.ts),
  [`packages/vault-core/src/proto/vault.ts`](../../packages/vault-core/src/proto/vault.ts)
- Client-facing authentication operations:
  [`auth.router.ts`](../../packages/api-contract/src/routes/v1/auth.router.ts)
