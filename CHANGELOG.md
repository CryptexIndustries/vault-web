# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-07-06

### Added

- Embedded Stripe checkout replaces the hosted checkout URL flow, with checkout session polling, cache refresh, close-dialog abort handling, billing portal access, subscription legal copy, and payment tests.
- Account dialog tabs now separate account, upgrade, billing, and recovery flows.
- Send Link and Account flows now include checkout UI with monthly and yearly premium tier options.
- Browser extension autofill foundation, including password generation, save prompts, menu display, popup linking, and online service session logging.
- Extension vault idle detection and automatic vault locking.
- Encrypted link and synchronization transport.
- Dynamic TURN credentials for WebRTC connectivity.
- Post-quantum signing for synchronization messages.
- Password strength meters and OWASP Argon2id acknowledgment gates.
- Optional vault unlock hardening with recovery passphrases and second-factor credentials alongside the vault secret.
- Vault empty state guide and signup/signin call-to-action popover.
- Recovery phrase peek controls and improved account recovery copy with user ID display.
- Shared API contracts package and API contract stub generator.
- Seed-tiers Docker Compose service for product tier setup after migrations.
- Pre-production Docker Compose configuration and refreshed development environment examples.

### Changed

- Link send and receive dialogs were simplified, with clearer failure handling and smaller QR payloads.
- QR scanning now uses `@yudiel/react-qr-scanner`, progress UI, larger displayed QR codes, and a smaller chunk size for better scan reliability.
- Extension and web vault operations were modularized around extracted OS auth and VaultOperations protocols.
- Synchronization message handling was streamlined with updated message types, versioning, timestamps, and envelope error handling.
- Credential hashing now includes custom fields, deleted credentials are filtered from background processing, and credential hash fields are required.
- Vault secrets now stay in session storage with more aggressive cleanup instead of remaining on vault objects.
- Account, recovery phrase, vault view, popup, and connected-account states were refined for clearer user feedback.
- Payment, subscription, and tier API calls now use the shared API contract package.
- The `web` package version has been bumped to `v1.4.0`.
- Web type checking now uses bundler module resolution and stricter validation.
- Runtime and deployment tooling now target Node 24.16.0 and pnpm 11.8.0, with pinned Docker base images and PostgreSQL 18+ compose paths.
- Docker Compose naming, profiles, port bindings, environment variables, and package mounts were cleaned up for local and production workflows.

### Fixed

- Shared sync and link traffic now routes through the Online Services session port and refreshes authentication before signaling retries.
- QR linking reliability improved through chunk assembly, slower send-link rotation, longer sync QR cycles, and smaller QR linking payloads.
- Vault Manager and dashboard UI regressions were fixed, including sidebar width, mobile layout, connected device icon color, and connected account status.
- TURN configuration now uses host networking, port 443, and avoids repeated credential request loops.
- tRPC API routing was restored.
- Extension development builds now set the correct `NODE_ENV`.
- Web Docker builds were streamlined.
- Password strength warnings now respect disabled suggestion settings.
- Vault second factor data is cleared on delete.
- Unused dev mock routes and offscreen stubs were removed.

### Security

- Browser extension security was hardened with authenticated autofill iframe bootstraps, exact-host credential release, sender-origin binding, and explicit per-origin message allowlists.
- Extension proxy fetch destinations are restricted, unsafe credential URL schemes are rejected, and production builds strip debug console output.
- Vault encryption moved toward a KEK-DEK strategy, with additional authentication hardening and recovery metadata hidden from linked devices.
- Link and sync transport no longer logs plaintext credentials.
- Security headers were added.
- Payment API hardening added duplicate-checkout guards, customer ID validation, idempotency keys, premium product validation, rate limiting, and Stripe CSP updates.
- Feature voting and auth/device route inputs are now bound and validated more tightly.
- Marketing external links now use `noopener`.
- Clipboard secret-copy warnings were added.
- pnpm audit findings were resolved and pnpm was bumped for security.

### Chore

- Lefthook formatting automation was added for pre-commit checks.
- Dependencies and package overrides were refreshed, unused dialog components were removed, and notifications moved to `sonner`.
- Build outputs are ignored, example environment files were added, and extension formatting was cleaned up.

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
