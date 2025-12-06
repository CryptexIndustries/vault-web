# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release the Cryptex Vault Browser Extension v1.0.0
- Private credentials sharing.
- Automatic encrypted backups.
- Layered quantum-resistant encryption.

### Changed

- Redesign the in-vault UI.
- Complete test coverage.

## [1.2.0] - 2025-12-06

### Added

- QR code data can be copied in the in-vault linking dialog.
- Changelog dialog now highlights unseen releases.
- Implemented a new vault metadata editor in the Vault Manager.
- Implemented a credential generator dialog on every password input field.

### Changed

- Strip the linking configuration and devices from the generated backup.
- The `web` package version has been bumped to `v1.2.0`

### Fixed

- Removed reliance on the nodejs Buffer class.

## [1.1.0] - 2025-08-03

### Added

- Added the `CHANGELOG.md` file (#5).
- Changelog dialog inside the application.

### Changed

- Replaced `npm` with `pnpm` (#5).
- Changed the project structure to allow for browser extension collocation.
- Bumped the dependency versions.
- Stripe API integration now targets the latest version used by the account - not pinned to a specific version.
- The `web` package version has been bumped to `v1.1.0`.

## [1.0.2] - 2025-07-12

### Added

- Show a notification when the TURN server configuration is saved (#4).

### Fixed

- Make sure that the Vault Manager UI is refreshed when the last vault is removed (#4).
- In-vault dialog header title color has appropriate contrast.
- In-vault number input control text color has appropriate contrast.
- Signaling server configuration is now properly saved.
- In-vault STUN/TURN/Signaling server configuration dialog UI elements now use appropriate colors.

### Changed

- Remove `console.error` calls when the credential list is rendering (#4).
- In-vault credential list item favicons now load lazily.

## [1.0.1] - 2025-07-11

### Added

- Show all tier perks in the account dialog, along with an icon indicating whether or not it is available in the current tier (#3).

## [1.0.0] - 2025-07-01

### Fixed

- Fix Stripe configuration so that it accepts promotional codes (#1).
- Fix QR decoding when linking outside vault (#2).

### Changed

- Redesigned the index page.
- Redesigned the Vault Manager page.
- Rewrote the synchronization logic.
- Project made public.
