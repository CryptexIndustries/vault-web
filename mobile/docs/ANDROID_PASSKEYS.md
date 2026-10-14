# Android passkeys

Cryptex Vault is an Android Credential Manager provider on Android 14/API 34
and newer. The provider uses AndroidX Credentials 1.6.0, the current stable
release, and is separate from the conventional Autofill Service.

## Provider lifecycle

1. The user enables Cryptex Vault from Settings → Autofill → Passkeys.
2. While the vault is unlocked, Android receives only credential-entry display
   metadata. Passwords, passkey private keys, and vault encryption keys never
   enter the provider cache.
3. The provider cache expires with the configured vault timeout. A locked,
   expired, or restarted session returns an authentication action rather
   than credential entries.
4. Selecting an entry launches a short-lived relay activity. The existing vault
   unlock flow runs when needed and the selected request is completed only while
   it remains fresh.

## Creation

Creation accepts WebAuthn public-key requests that support ES256. Cryptex
validates the request, challenge, RP ID, user handle, caller-provided client data
hash, and `excludeCredentials`. A matching excluded credential is returned to
Android as `InvalidStateError`.

The generated P-256 private key is stored only in the encrypted vault. The
response uses none attestation, a stable provider AAGUID, user-presence and
user-verification flags, backup eligibility/state flags, and a zero signature
counter. A strong biometric or device credential verifies the user before key
generation. The vault write completes before Android receives the successful
registration response.

## Assertion

Android filters passkeys by RP ID, discoverability, and `allowCredentials`
before showing entries. Cryptex repeats the RP ID and allow-list checks before
using the private key, requires a strong biometric or device credential,
validates the caller client-data hash, and returns a DER encoded ES256
signature. Selecting an exact passkey entry completes directly after user
verification; the app does not ask the user to choose the same credential
twice.

Privileged browser origins are accepted only when AndroidX validates the
caller package and signing certificate against the bundled privileged-caller
list. Native-app callers require a matching Digital Asset Links relation
from the requested RP website. Related Origin Requests are left to the platform and
relying party as required by Android's provider guidance; Cryptex does not add
an incorrect origin-equals-RP check.

## Caller verification and network traffic

The bundled `passkey_privileged_callers.json` preserves the public
[privileged-caller list](https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json)
retrieved on 2026-09-29. AndroidX enforces its package, certificate, and build-type
rules locally. There is no runtime list download. Review package/certificate
changes before updating this file in an app release.

Native-app verification requests `https://<rpId>/.well-known/assetlinks.json`.
It matches `android_app`, the exact package, a signing certificate, and
`delegate_permission/common.get_login_creds`. Certificate rotation can match
signing history; apps with multiple current signers must link every signer.
HTTPS includes are supported, with at most 10 include statements, no redirects,
256 KiB per file, and a 10-second shared request budget. Connect/read timeouts
are at most 5 seconds. JSON nesting is limited to 32 levels.

Only the RP website and its explicit include hosts receive requests. Package
names and certificate fingerprints stay on-device. Those hosts still see the
device's IP address and request timing, even with cloud features disabled.
There is no association cache or fallback to a verification API. Network or
verification failure rejects the native-app request. Browser caller validation
works offline; completing a website ceremony may still require connectivity.

## Verification

WebAuthn encoding, exclusion and allow-list enforcement, signature
verification, malformed input, and caller-hash handling are covered by Jest.
Native tests cover exact associations, delegation, signer rotation, multiple
signers, invalid responses, request limits, and revocation without caching.
Android instrumentation checks the bundled list and AndroidX caller rejection.
The Expo module is compiled by the Android Gradle build. Maestro create/get
flows and physical-device instructions live under `mobile/e2e`.

Run the native verifier suites from `mobile/android` with a connected emulator:

```sh
./gradlew :cryptex-android-credentials:testDebugUnitTest :cryptex-android-credentials:connectedDebugAndroidTest
```

References:

- [Android credential provider integration](https://developer.android.com/identity/sign-in/credential-provider)
- [AndroidX Credentials releases](https://developer.android.com/jetpack/androidx/releases/credentials)
- [Digital Asset Links statement syntax](https://developers.google.com/digital-asset-links/v1/statements)
- [Website association requirements](https://developer.android.com/identity/credential-manager/prerequisites)
