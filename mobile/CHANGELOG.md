# Android changelog

Each `mobile-vX.Y.Z` release and the Android tab of the changelog page show that version's section.

## 0.5.0 - 2026-10-30

### Added

- Backup destinations in the Backup Center. After each change, the app uploads an encrypted backup to the user's own S3-compatible buckets, such as AWS S3, Backblaze B2, Cloudflare R2, MinIO or Garage. Uploads go straight from the phone to the bucket, and the bucket keys sync with the vault. Each device thins the backups in its own folder by age, like managed backups do, or keeps them all.
- The restore screen can list the backups in a bucket and restore one as a new vault.
- The app is available in Croatian. It follows the phone's language by default and can be changed in the Settings, or with the EN/HR switch at the top of the first screen before a vault is created.

### Fixed

- Sync now works with a STUN server entered as a `stun:` URL in the web app, and with a TURN server whose host is named `turn`, such as `turn:3478`. Sync used to build an invalid address for both.
- Restoring a managed backup no longer fails at the captcha step, and each backup in the list shows its date and source device instead of a blank button.
- A managed backup taken while the vault's security settings are changed or the Recovery Kit is rotated can now always be restored. Before, such a backup could pair the new settings with the old key and fail to restore.
- On a new install, slow phones no longer show a blank screen after a vault is created, restored or unlocked.
- Pulling down at the top of a bottom sheet no longer swallows the next tap.

## 0.4.0 - 2026-10-25

### Changed

- The first screen's Link Vault tab is called Use invitation, the same name as in the web app and the Devices tab.
- Before signing up, the Account tab points to Use invitation, so a second device joins the existing account instead of creating a new one.
- When the receiving vault has its own Online Services account, the app explains that linking moves the vault to the sending device's account. The old account can be kept or deleted before linking. A Google Play subscription has to be cancelled in the Play Store.

## 0.3.0 - 2026-10-23

### Added

- SSH logins and git signing can be approved from the phone with `cryptex-agent`, the new keyless SSH agent for Linux. The agent pairs with a QR code and uses only the keys picked for it, and each of its requests can be approved, denied or paused.
- SSH keys are vault items, generated or imported, and can be shared through a one-time link.
- New subscribers get a 14-day free trial of Online Services.

### Fixed

- Exports, Recovery Kit sharing and autofill stop if the vault locks partway through. Account recovery warns first and offers a new Recovery Kit.
- Device linking shows a countdown and no longer hangs.

## 0.2.0 - 2026-10-14

### Added

- One-time share links for logins and text, with a list to track and revoke them.

### Changed

- Device linking shows each step as it happens.
- Clearer messages while a payment is confirmed.

## 0.1.0 - 2026-10-08

### Added

- First release. Passwords, passkeys and verification codes are stored in an encrypted vault on the device. It works locally without an account, or linked devices sync with the web app and browser extensions. Online Services are optional.
