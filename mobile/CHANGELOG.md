# Android changelog

Each `mobile-vX.Y.Z` release and the Android tab of the changelog page show that version's section.

## 0.4.0 - 2026-10-25

### Changed

- The first screen's Link Vault tab is called Use invitation, the same name as in the web app and the Devices tab.
- Before you sign up, the Account tab points to Use invitation, so a second device joins your existing account instead of creating a new one.
- When the receiving vault has its own Online Services account, the app explains that linking moves the vault to the sending device's account. You can keep the old account or delete it before linking. A Google Play subscription has to be cancelled in the Play Store.

## 0.3.0 - 2026-10-23

### Added

- Approve SSH logins and git signing from your phone with `cryptex-agent`, the new keyless SSH agent for Linux. Pair it with a QR code, choose its keys, and approve, deny or pause its requests.
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

- First release. Store passwords, passkeys and verification codes in an encrypted vault on your device. Use it locally without an account, or link your devices to sync with the web app and browser extensions. Online Services are optional.
