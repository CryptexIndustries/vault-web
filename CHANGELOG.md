# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Link vault transfers now carry an ML-DSA signature over the KEM transfer context. Receivers verify the sender before KEM decapsulation and reject unsigned transfers from older senders.

## [1.4.0] - 2026-07-06

### Added

- Added a Backup Center with manual encrypted downloads, optional Premium zero-knowledge restore points, backup status and history, and controls for uploading, downloading, pausing, and deletion. The Vault Manager can restore local `.cryx` files or recover managed backups on a fresh device using an Online Services User ID and Recovery Kit without overwriting an existing vault.
- Added a browser-local setting for choosing the web vault inactivity auto-lock timeout.
- Introduced the browser extension with authentication-form detection, origin-bound autofill, credential saving and management, password generation, popup linking with passphrase generation, consistent secret reveal controls, Online Services session logging, and idle auto-locking.
- Added first-class vault directories across the web app, extension, import/export, and linked-device synchronization, including filtering, lifecycle management, per-credential assignment, bulk moves, deterministic conflict handling, and migration of legacy groups to Root.
- Added refresh-token storage and rotation to the web and extension Online Services clients, including single-flight refreshes, stale-session generation guards, and server-side session revocation during logout and vault locking.
- Added embedded Stripe checkout, monthly and yearly Premium options, billing portal access, and dedicated account, upgrade, billing, and recovery flows.
- Added end-to-end encrypted linking and synchronization with compact QR exchange, dynamic TURN credentials, post-quantum message signing, and improved retry and signaling behavior.
- Added password-strength guidance and optional additional key protection with recovery phrases and WebAuthn security keys, including OWASP Argon2id acknowledgment gates.
- Added vault onboarding and account-recovery guidance, including an empty-state guide, signup/signin prompts, recovery phrase peek controls, and user ID display.
- Added a shared API contracts package and API contract stub generator.
- Refreshed vault importing with guided previews, warnings and result counts, optional import during vault creation, and support for Cryptex Vault JSON, Bitwarden JSON, 1Password CSV/1PUX, KeePass CSV/XML, LastPass CSV, Chrome CSV, and Firefox CSV.
- Credentials can store multiple website rules with exact-host, parent/sibling domain, or safe wildcard matching.

### Changed

- Online Services Recovery Kits can now be rotated, invalidating the previous Kit and active recovery sessions, and a replacement Kit is requested after fresh-device managed-backup recovery.
- Removed the unused feature-voting API contract and Premium perk listing.
- Removed the public contact form and its feedback API contract, while retaining the static privacy-policy contact section.
- Account, recovery phrase, vault view, popup, and connected-account states were refined for clearer user feedback.
- The `web` package version has been bumped to `v1.4.0`.
- Consolidated runtime and deployment tooling around Node 24.16.0, pnpm 11.8.0, pinned Docker images, PostgreSQL 18+ Compose paths, service-discovery networking, health checks, cleaned-up profiles and mounts, pre-production configuration, and product-tier seeding.
- Web type checking now uses bundler module resolution and stricter validation.

### Fixed

- Preserved `Version` and `CurrentVersion` while deserializing encrypted blobs, allowing restored pre-envelope v2 vault backups to unlock instead of failing with `INVALID_VAULT_VERSION`.
- tRPC API routing was restored.

### Security

- Browser extension security uses authenticated autofill iframe bootstraps, exact-host credential release, sender-origin binding, explicit per-origin message allowlists, restricted proxy destinations, and safe credential URL schemes; production builds also strip debug console output.
- Vault encryption moved toward a KEK-DEK strategy; vault secrets are confined to session storage, recovery metadata is hidden from linked devices, deleted additional-protection key data is cleared, and copied-secret warnings reduce accidental exposure.
- Link and sync transport no longer logs plaintext credentials.
- Web security headers were added, and external links now use `noopener`.
- Payment API hardening added duplicate-checkout guards, customer ID validation, idempotency keys, premium product validation, rate limiting, and Stripe CSP updates.
- Account deletion now requires a freshly signed root-device challenge, and auth and device route inputs are bound and validated more tightly.
- Production tRPC error logging now omits request inputs and response details to prevent sensitive data from reaching browser logs.
- pnpm audit findings were resolved and pnpm was bumped for security.
- CSV import parsing stays on the main thread to avoid relaxing Content Security Policy for blob workers while handling plaintext password exports.

### Chore

- Refreshed dependencies and overrides, added Lefthook formatting checks, moved notifications to `sonner`, removed unused UI and development stubs, ignored build outputs, refreshed environment examples, and cleaned up extension formatting.
- Expanded regression coverage for directories, import/export, synchronization, extension field detection, legacy restore, payments, and Online Services session and backup behavior.

## [1.3.1] - 2026-01-06

### Changed

- The `web` package version has been bumped to `v1.3.0`.
- The `next` package version has been bumped to `v15.3.8`.

## [1.3.0] - 2026-01-06

### Added

- Introduced a Log Inspector dialog for enhanced debugging and log management.
- Added an auto-confirm countdown to the Vault Lock dialog.
- Added a `showPasswordGenerator` prop to `FormInput` for optional password generator buttons, and removed the default generator from the vault unlock secret input.
- Added autofocus to the secret key input in the Unlock tab for faster entry.

### Changed

- Started unifying vault UI components for a more consistent experience.
- The `web` package version has been bumped to `v1.3.0`.
- Updated `.gitignore` to exclude extension build artifacts.

### Fixed

- Correctly reference the credentials list in `applyDiffs` so vault synchronization works properly.
- Added a short UI delay in the Unlock Vault dialog to improve responsiveness during unlock.
- Unified HTML5 quote escape sequences in `unlock.tsx` to avoid parsing inconsistencies.

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
