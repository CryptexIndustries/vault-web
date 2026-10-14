# Network services in the F-Droid build

Creating and using a local vault requires no account or subscription. Online Services remain available in the F-Droid build. The listing declares `NonFreeNet` because these optional account flows use proprietary network services. This label follows [F-Droid's anti-feature definitions](https://f-droid.org/en/docs/Anti-Features/#Non-Free-Network-Services); final classification belongs to the packagers.

| Operation | Service and purpose |
| --- | --- |
| Account creation and protected account recovery | Cloudflare Turnstile verifies the request through the web-hosted mobile challenge bridge. |
| Subscription checkout and billing management | Stripe opens in the system browser. The app does not collect card details. |
| Account and managed backup operations | `api.cryptex-vault.com` provides the Online Services API. Encrypted backup storage uses Backblaze B2. |
| Device synchronization | Configured signaling and STUN/TURN servers connect devices. Connection settings allow custom servers; the vault transfers encrypted data. The default signaling endpoint is `neosignaling.cryptex-vault.com`. |
| Passkey caller verification | Native Android callers can require a request to the relying-party website's Digital Asset Links file. Browser verification uses a bundled list. See [Android passkeys](../docs/ANDROID_PASSKEYS.md). |

The public production endpoints and client keys are checked in at [release-config.json](../release-config.json). An unsigned source build needs no private signing key. Source builders can choose `--offline-services` to hide Online Services flows.

Expo OTA updates are disabled for this distribution, including automatic checks, update URLs, channel headers and OTA signing metadata. Application updates come through F-Droid. Standard and preproduction distributions retain their existing OTA behavior.
