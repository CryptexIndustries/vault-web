# Web app changelog

Each `web-vX.Y.Z` release and the Web app tab of the changelog page show that version's section.

## 1.9.0 - 2026-10-29

### Added

- Test connection checks a STUN, TURN or signaling server from your browser before you save it.

### Changed

- Vault signaling lists your servers, and each one is saved on its own. It used to be one long form with a single Save button.
- Deleting a server that a linked device uses now warns you first.

### Fixed

- Sync now works with a STUN server entered as a `stun:` URL, and with a TURN server whose host is named `turn`, such as `turn:3478`. Sync used to build an invalid address for both.

## 1.8.1 - 2026-10-27

### Added

- The Android app is on Google Play. Find it on the Android download page.

## 1.8.0 - 2026-10-25

### Added

- Set up a new browser by linking it to a device you already use. Open the Use invitation tab instead of creating a vault, receive your vault, then choose a master password for this browser.

### Changed

- If the receiving vault has its own Online Services account, you now choose whether to keep or delete it before linking. Linking into such a vault used to fail with "Unauthorized".

## 1.7.0 - 2026-10-21

### Added

- SSH key items. Generate or import Ed25519, ECDSA and RSA keys, copy or save the public key, and share a key through a one-time link.
- The web app approves SSH agent requests, and you can pause or revoke an agent from any linked device.
- A 14-day free trial of Online Services for new subscribers. Add a card to start it. You're charged when the trial ends unless you cancel before then.

### Changed

- The vault can be open in only one browser tab at a time, and leaving it for another page of the site locks it after saving.

## 1.6.0 - 2026-10-15

### Added

- The account dialog shows what your plan includes. On the free plan you see what Online Services adds and what it costs, instead of an empty billing card. Subscribers see each service with its allowance and how many linked devices they use.
- A new download page lists every way to get Cryptex Vault. The Android page explains how to install the app from our F-Droid repository.

### Changed

- Dialogs, menus and dropdowns in the web vault now use the dark theme, and Delete account and other destructive buttons are readable in it again.

## 1.5.0 - 2026-10-14

### Added

- Credential rules in the web app and extension now accept exact Android app associations such as androidapp://com.example.app. These associations stay separate from website matching.
- A new billing return page takes you back to the web vault or Android app. A return button stays available if your browser blocks automatic navigation.
- Share a credential or any text through a link that opens once. You pick the fields, when the link expires and whether it needs a passphrase. Your device encrypts it, and the key stays in the link, so the share server can't read what you send.
- Shared links shows every link you've sent and whether it was opened. You can search and filter it, and revoke a link nobody has opened yet. It syncs between your devices.
- If you self-host, you can run the open-source share server next to your web app and hand out creation tokens to the people who may send links.
- If you subscribed through Google Play or the App Store, the account dialog says so and tells you where to manage the subscription.

### Changed

- The device linking dialog now says "Verification words" instead of "Mnemonic", the same term the extension, Android app and documentation use.

### Fixed

- Device linking and synchronization now wait for delayed connection candidates instead of failing immediately. Pending failure timers are cleared when connections end or are replaced.
- Failures while deriving the password key now return a handled vault unlock error.

## 1.4.1 - 2026-09-25

### Added

- Sort vault credentials by name in either direction, recently updated, or newest created. The web app remembers your choice in this browser.
- Manage your linked devices from Account or the vault sidebar. A connection map and searchable list show each device and its links, including direct links that do not use Online Services.
- Change your master password and extra key protection, generate a new vault recovery code, or rotate this device's encryption key from Vault Security. Key rotation gives you a new recovery code. In the web app, your recovery code can also be used to set a new password.
- Self-hosting templates are available for the web app and its device-linking services, including secure TURN setup.

### Changed

- Device actions now make it clearer when you are connecting, syncing, unlinking, or removing a device. Sidebar quick actions also work with a long press on touch screens.
- When managed backups are enabled, security changes start a fresh backup. You can opt to delete older account restore points, including linked-device copies, after the upload succeeds. Downloaded backups remain yours to delete and still use the password and recovery information they had when downloaded.
- Imports now show what will be added, skipped, or saved differently before you confirm. More details from Bitwarden, 1Password, KeePass, LastPass, Chrome, and Firefox exports are carried over, and invalid files show clearer errors.
- Boolean custom fields now have an on/off switch in the web credential editor.

### Fixed

- Text in password and secret fields now stops before the show, copy, and generate icons instead of running underneath them.
- Synchronization handles simultaneous connections and disconnects more reliably. A failed vault save no longer appears as a successful sync, and secure custom relay server addresses now work.
- Backup Center now shows current coverage only after a backup has finished uploading.
- Vault transfers now verify the sending device before accepting the encrypted vault. Update the sending device if a new link reports that its transfer could not be authenticated.

## 1.4.0 - 2026-07-06

### Added

- Credentials can store multiple website rules with exact-host, parent/sibling domain, or safe wildcard matching.
- A new Backup Center provides encrypted downloads and optional Online Services managed restore points with backup status, history, and management controls. Restore local files or recover on a fresh device without replacing an existing vault, and rotate or replace your Recovery Kit for future recovery.
- Choose how long the web vault waits before automatically locking after inactivity.
- Organize credentials into directories across the web app and extension, move multiple credentials at once, and preserve directories through imports, exports, and linked-device synchronization.
- Payments now stay inside Cryptex Vault with embedded monthly and yearly checkout, billing management, and clearer account and recovery flows.
- Vault protection now includes password-strength guidance, optional recovery phrases and additional protection keys, safer secret handling, and clearer setup and recovery controls.
- Import passwords from Cryptex Vault, Bitwarden, 1Password, KeePass, LastPass, Chrome, and Firefox using a guided preview, including during new vault setup.
- Linking and synchronization are now encrypted end-to-end with more reliable QR exchange, improved connectivity, and post-quantum message signing.

### Changed

- Online Services sessions now refresh and sign out more reliably, including when locking a vault or removing an account connection.
- Vault, account, recovery, and connected-device screens have been refined for clearer feedback.

### Fixed

- Older v2 vault backups can be restored and unlocked again without an invalid-version error.
- Production Online Services error logs no longer include request inputs or response details that may contain sensitive information.

### Removed

- Removed the unused Online Services feature-voting integration and outdated subscription perk listing.

## 1.3.0 - 2026-01-06

### Added

- Introduced a Log Inspector dialog for enhanced debugging and log management.
- Added an auto-confirm countdown to the Vault Lock dialog.
- Added a `showPasswordGenerator` prop to `FormInput` for optional password generator buttons, and removed the default generator from the vault unlock secret input.

### Changed

- Started unifying vault UI components for a more consistent experience.
- Added autofocus to the secret key input in the Unlock tab for faster entry.
- The `web` package version has been bumped to `v1.3.0`.
- Updated `.gitignore` to exclude extension build artifacts.

### Fixed

- Correctly reference the credentials list in `applyDiffs` so vault synchronization works properly.
- Added a short UI delay in the Unlock Vault dialog to improve responsiveness during unlock.
- Unified HTML5 quote escape sequences in `unlock.tsx` to avoid parsing inconsistencies.

## 1.2.0 - 2025-12-06

### Added

- QR code data can be copied in the in-vault linking dialog.
- Changelog dialog now highlights unseen releases.
- Implemented a new vault metadata editor in the Vault Manager.
- Implemented a credential generator dialog on every password input field.

### Changed

- Strip the linking configuration and devices from the generated backup.
- The `web` package version has been bumped to `v1.2.0`.

### Fixed

- Removed reliance on the nodejs Buffer class.

## 1.1.0 - 2025-08-03

### Added

- Added the `CHANGELOG.md` file (#5)
- Changelog dialog inside the application

### Changed

- Replaced `npm` with `pnpm` (#5)
- Changed the project structure to allow for browser extension collocation
- Bumped the dependency versions
- Stripe API integration now targets the latest version used by the account - not pinned to a specific version
- The `web` package version has been bumped to `v1.1.0`

## 1.0.2 - 2025-07-12

### Added

- Show a notification when the TURN server configuration is saved (#4)

### Changed

- Remove `console.error` calls when the credential list is rendering (#4)
- In-vault credential list item favicons now load lazily

### Fixed

- Make sure that the Vault Manager UI is refreshed when the last vault is removed (#4)
- In-vault dialog header title color has appropriate contrast
- In-vault number input control text color has appropriate contrast
- Signaling server configuration is now properly saved
- In-vault STUN/TURN/Signaling server configuration dialog UI elements now use appropriate colors

## 1.0.1 - 2025-07-11

### Added

- Show all tier perks in the account dialog, along with an icon indicating whether or not it is available in the current tier (#3)

## 1.0.0 - 2025-07-01

### Changed

- Redesigned the index page
- Redesigned the Vault Manager page
- Rewrote the synchronization logic
- Project made public

### Fixed

- Fix Stripe configuration so that it accepts promotional codes (#1)
- Fix QR decoding when linking outside vault (#2)
