# Chromium Extension changelog

Each `extension-vX.Y.Z` release and the Extension tab of the changelog page show that version's section. The extension's version follows the web app's, so a version can have no extension changes.

## 1.9.0 - 2026-10-29

### Added

- Backup destinations in the Backup Center. After each change, the extension uploads an encrypted backup straight to S3-compatible buckets you control. Destinations sync with your vault to your other devices. Each device thins out older backups in its own folder the way managed backups do, or keeps them all.

### Fixed

- Sync now works with a STUN server entered as a `stun:` URL, and with a TURN server whose host is named `turn`, such as `turn:3478`. Sync used to build an invalid address for both.

## 1.8.1 - 2026-10-27

### Changed

- No changes to the extension. Released alongside web app 1.8.1.

## 1.8.0 - 2026-10-25

### Changed

- The popup stays responsive with large vaults. It draws only the credentials in view, so searching and editing no longer stall with hundreds of items, and it opens about twice as fast with 500 credentials.
- Unlocking derives the vault key once instead of twice, so it takes about half as long with the default security settings.

### Fixed

- The popup keeps working after the extension renews its internal message key, which happens every 30 days. Unlock, save and lock used to fail once after a renewal.
- If the popup can't reach the extension's background service, it says so and offers Try again instead of a loading spinner. A vault that locks while the popup opens now shows as locked.

## 1.7.0 - 2026-10-22

### Added

- SSH key items. Generate an Ed25519 key or import an existing one, copy or save the public key, save the private key as a file, and share a key through a one-time link.

### Changed

- Copying a username, website or public key shows a plain "Copied" message. Passwords, codes and private keys keep the reminder to clear the clipboard.
- Receiving a vault from another device shows a countdown and stops waiting when the other device goes away.
- Dialogs and menus use the dark theme, and highlighted menu items are readable in it.

## 1.5.0 - 2026-10-14

### Added

- One-time share links. Send a credential or any text through an encrypted link that opens once.
- A Shared links list shows which links were opened and revokes the rest.
- Credential rules accept Android app associations.

### Fixed

- The extension locks your vault when your computer's screen locks, not only after 30 minutes of inactivity.
- An open extension tab shows the unlock screen as soon as the vault locks somewhere else.

## 1.4.1 - 2026-10-06

### Added

- First release. The extension recognizes sign-in forms, fills, saves and manages credentials for the current site, generates passwords and linking passphrases, and locks when idle.
- Change your master password and extra key protection, generate a new vault recovery code, or rotate this device's encryption key from Vault Security.
