# Mobile changelog

Release notes for the Android and iOS apps. Each `mobile-vX.Y.Z` release and the Android & iOS tab of the changelog page show that version's section.

## 0.7.0 - 2026-11-26

### Added

- iOS support.

### Changed

- The password generator matches the one in iOS AutoFill.
- Subscribing has its own payment step. It shows whether Google Play or Stripe is waiting for you, checking the payment or confirming the membership.
- Account recovery says how many attempts it allows before you start, and explains in plain words why an attempt failed.
- Biometric unlock says "biometrics" instead of "fingerprint".

### Fixed

- If your Google account already has the subscription, the app says so and points you to Restore Google Play purchases.
- Account recovery no longer hangs after you confirm it.
- The accessibility fallback saves a field labelled as a username even when it uses the email keyboard, keeps a fill request while Android restarts the service, and reads web field labels in Chrome 155.
- Bottom sheets no longer stick at the screen edge when reduced motion is on.
- A failed snapshot download in the Backup Center shows its error inside the sheet.
- On tablets, forms, lists and the device panel no longer stretch across the whole screen, the list highlights the item open in the detail pane, and the unlinked-devices title fits in the device map.
- The Directories screen has a back button.
- A tab opened again while the previous tab switch was still animating no longer goes blank.
- Authenticator codes with a period that doesn't divide a minute, such as 45 or 90 seconds, count down correctly, and copying a code copies a freshly generated one.
- Creating a share link that takes more than 10 seconds shows a warning to keep the screen open. Other share requests give up after 30 seconds instead of waiting.

## 0.6.0 - 2026-11-15

### Added

- The Backup Center says when a managed backup or a backup destination fails, and why. A dot on the More tab and on the Backup Center row stays until backups work again.

### Changed

- The Backup Center opens on the vault's backup status and how much managed storage is used. Managed backups and backup destinations each have their own screen, and the backup history is on the managed backups screen.
- When managed backup storage is full, the app no longer retries every minute. It tries again after the next change to the vault or a tap on Back up now.
- SSH agents on a Mac show as macOS, and the pairing steps no longer assume the agent runs on Linux.

### Fixed

- Sync accepts STUN and TURN server URLs with an IP address, such as `turn:192.0.2.1:3478`.
- Saving a STUN or TURN server whose host is named `stun` or `turn`, such as `turn:3478`, keeps the host name.
- Using the SSH agent no longer uploads a managed backup for each request. The request history goes into the next backup.

## 0.5.1 - 2026-11-02

### Fixed

- Sync skips a device that was linked before devices had sync IDs instead of failing on it. That device syncs again once it is relinked.
- Sync signs in to Online Services again only when the session has expired, not after every failed request.

## 0.5.0 - 2026-10-31

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
