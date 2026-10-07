# Android E2E

The flows use Maestro against a dedicated debug-signed E2E APK. Native projects are
derived from `app.json` and local Expo modules; `mobile/android` is generated
and ignored. Check vendor-specific system screens on physical devices before release.

Use `--profile preprod` consistently for preproduction builds and E2E commands.
If the existing native project belongs to another profile, back it up with
`--regenerate-native`; see [the mobile README](../README.md).

Only the E2E build disables screenshot blocking in the main activity so Maestro
can inspect the vault window. Regular development and production builds keep
Android secure-window protection enabled from activity creation. The credential
request relay remains protected in every build.

```sh
export MAESTRO_DEVICE=emulator-5554
pnpm mobile:build -- --e2e
adb -s "$MAESTRO_DEVICE" install -r -t mobile/android/app/build/outputs/apk/e2e/app-e2e.apk
pnpm mobile:e2e -- smoke --device emulator-5554
```

The E2E build passes `--no-clean` when updating the existing Android project.
Expo still rewrites plugin-managed files and can recreate a malformed native tree;
back up manual native edits and keep durable changes in plugins/modules.

Use Android 11 or newer for the conventional autofill suite. The deterministic
flows run on a dedicated emulator; also check inline and popup suggestions on a
physical device before release. Start
`pnpm mobile:e2e -- fixture` and run
`adb -s "$MAESTRO_DEVICE" reverse tcp:43110 tcp:43110` for the deterministic login pages.
Unlock the Android device before starting Maestro; a first-boot lock screen
prevents its instrumentation from starting.
On an emulator with a physical keyboard configured, enable its software keyboard
before testing so Maestro's keyboard dismissal does not navigate Back:

```sh
adb -s "$MAESTRO_DEVICE" shell settings put secure show_ime_with_hard_keyboard 1
```

Set the intended device once, then choose a suite. Every device suite requires
`--device`, `MAESTRO_DEVICE`, or `ANDROID_SERIAL`; none silently selects a device.
Set `CRYPTEX_E2E_PROTECTED_DEVICE` to a serial that must remain untouched; device
commands reject that serial before invoking ADB. This guard has no implicit
protected serial: export it explicitly for each session.
`pnpm mobile:e2e -- --help` lists every suite.
CI pins Maestro 2.9.0 and verifies the upstream archive checksum before extraction.

```sh
export CRYPTEX_E2E_PROTECTED_DEVICE=protected-device-serial
export MAESTRO_DEVICE=emulator-5554
pnpm mobile:e2e -- smoke
pnpm mobile:e2e -- credentials
pnpm mobile:e2e -- autofill
pnpm mobile:e2e -- autofill-app-association
pnpm mobile:e2e -- autofill-coverage
pnpm mobile:e2e -- autofill-provider-password
pnpm mobile:e2e -- autofill-accessibility
pnpm mobile:e2e -- provider-auto-lock
pnpm mobile:e2e -- passkeys
pnpm mobile:e2e -- security
pnpm mobile:e2e -- cloud
pnpm mobile:e2e -- devices
pnpm mobile:e2e -- import-export
```

Maestro options can follow the suite, for example
`pnpm mobile:e2e -- smoke --include-tags quick`. Results stay under
`mobile/e2e/results`. The fixture and target helpers do not need a device.

The same runner exposes native checks:

```sh
pnpm mobile:e2e -- qr
pnpm mobile:e2e -- native --device emulator-5554
pnpm mobile:e2e -- crypto --device emulator-5554
pnpm mobile:e2e -- crypto-audit --apk mobile/dist/cryptex-vault-unsigned.apk
```

Build a development or E2E APK first to generate the Android project. The crypto
journey builds a separate test-only `com.cryptex.vault.cryptotest` APK, not a
publication release. It rebuilds `mobile/android/app/build/outputs/apk/e2e/app-e2e.apk`
and leaves production APKs under `mobile/dist` untouched. The artifact audit checks
a production APK built separately with `pnpm mobile:build`, or
`pnpm mobile:build -- --unsigned` for reproduction.

## Conventional autofill suite

Build and install the small native target app before running the suite:

```sh
pnpm mobile:e2e -- target
adb -s "$MAESTRO_DEVICE" install -r -t mobile/e2e/fixtures/autofill-target/app/build/outputs/apk/debug/app-debug.apk
pnpm mobile:e2e -- autofill --device emulator-5554
```

The suite covers browser login, locked-vault return, TOTP clipboard handoff,
browser registration saving, cross-origin frame isolation, native-app
association warnings and cancellation, search across the vault, native
registration saving, password updates, inline suggestions, and the standard
Android fallback presentation. The target app is test-only and is not linked
into the Cryptex Vault APK.

Chrome may require `enable-autofill-virtual-view-structure` for third-party
autofill. The browser setup flow enables it when needed, then selects
**Autofill using another service** in Chrome settings.

The application-association journey separately verifies one-time filling,
explicitly remembering an unmatched app, exact matching on the next request,
the retained safety confirmation, persisted credential targets, and isolation
between native package associations and website-origin matching.

The coverage suite separately captures both Android suggestion
presentations and exercises exact-host, parent-domain, and safe-wildcard rules
against offline test-app forms that publish synthetic HTTPS origins. Run the
opt-in live registration regression with
`pnpm mobile:e2e -- autofill-live-registration`; it uses sample data on the public
test form and verifies that the separate email survives the save review.

The separate Credential Manager password suite exercises password creation,
retrieval, and cancellation through the native test target. Select Cryptex Vault
as the device's credential provider before running it. The command requires
`MAESTRO_DEVICE` so it cannot silently select another connected device.

The accessibility suite requires an explicit `MAESTRO_DEVICE` and fails closed
when it is absent. It enables the optional service through Android settings,
then uses fixture forms that opt out of Autofill Framework participation. It
covers the disclosure and system opt-in, one-time fill and remembered package
association, OTP-only filling from an already-unlocked vault, explicit
save/update review with separate email and username fields, locked-vault
return, cancellation without fill, and cross-origin frame review. System
wording differs between vendors. The setup handles API 35 and API 36
service-selection labels; other profiles may need changes. Android does not
expose one accessibility service's overlay to
another service. An active UiAutomation session can also suppress events to
other accessibility services. The suite therefore runs as 15 state-preserving
Maestro phases.
Between phases, after UiAutomation disconnects, the runner uses the selected
emulator's system input channel to trigger accessibility actions and complete
pending credential-review actions; Maestro drives and verifies every
surrounding interaction. The runner scales those coordinates from the pinned
1080×2400 AVD profile and confirms the real accessibility-overlay window exists
before each press. Picker steps affected by keyboard layout locate controls by
their Android UI text and bounds before tapping. A confirmed fallback fill can
reach visible embedded forms and may reach an off-screen form; the frame flow
requires all fields empty after cancellation. After explicit cross-site
confirmation, it requires exact page and visible-frame username/password values.
Each hidden-frame field must remain empty or match the selected fixture value;
an incorrect value fails, including in a partial hidden snapshot.

## Biometrics and auto-lock

Use a disposable emulator with a genuine enrolled fingerprint. If its system
fingerprint enrollment screen crashes, choose another image.

A secure Android screen lock is required for authentication-bound Keystore and
SecureStore keys and genuine fingerprint enrollment. The scripted security and
passkey journeys also require an enrolled fingerprint; a PIN alone is insufficient.
See Android's [authentication-required key documentation](<https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setUserAuthenticationRequired(boolean)>)
and [emulator fingerprint commands](https://developer.android.com/studio/run/emulator-console#fingerprint).

The Android screen-lock PIN is separate from the Cryptex vault master password.
Android uses its PIN for the lock screen, fingerprint enrollment confirmation,
and device-credential authentication. Passkey user verification permits Android's
device-credential fallback. Vault creation, password unlock and enabling biometric
unlock still use the vault's own master password; a device PIN does not replace it.

```sh
export CRYPTEX_E2E_PROTECTED_DEVICE=protected-device-serial
export MAESTRO_DEVICE=emulator-5554
export ANDROID_SERIAL="$MAESTRO_DEVICE"
export CRYPTEX_E2E_DEVICE_PIN=123456
export CRYPTEX_E2E_FINGER_ID=1
bash mobile/e2e/enroll-emulator-fingerprint.sh
pnpm mobile:e2e -- security
pnpm mobile:e2e -- passkeys
```

The enrollment helper defaults `CRYPTEX_E2E_DEVICE_PIN` to `123456` and requires
at least six digits when enrollment is needed. It verifies that PIN against an
existing screen lock or sets it on a device without a credential. It cannot
replace an unknown existing PIN. An already-enrolled fingerprint makes the helper
return immediately, so that shortcut does not verify the PIN. Record the actual
PIN when preparing a new reusable test AVD rather than assuming the default.

The security and passkey commands supply genuine `emu finger touch 1` events
while Maestro runs and require an enrolled fingerprint. `CRYPTEX_E2E_FINGER_ID`
defaults to `1` and selects another already-enrolled ID when overridden. The
biometric runner does not enter a PIN or enroll a fingerprint. Unlock the Android
screen before starting the suite, and use the recorded PIN if Android requests it.
Android BiometricPrompt, Keystore and SecureStore behavior remain unchanged.

The standard E2E vault master password is `CorrectHorseBatteryStaple42`.
The two-device receiver uses `ReceiverHorseBatteryStaple42`; web-transfer checks
use `WebHorseBatteryStaple42`. These fixture passwords belong to their respective
vaults and are never Android screen-lock PINs.

The separate `provider-auto-lock` command creates its own password credential,
sets one-minute auto-lock, waits for expiry, verifies the vault is locked, and
unlocks the original pending Credential Manager request. It checks refreshed
entries and the exact returned username and password, then verifies a second
fresh request returns the same password.

## Import, export and restore

Install the native target fixture before `import-export`. Its Android share
receiver saves the actual exported bytes into Downloads; the journey uses
DocumentsUI to restore the encrypted `.cryx` file and import readable JSON into
a separate empty vault. It rejects an incorrect restore password, checks
credential fields including the password, and checks restored data after an app
restart. The share receiver belongs only to the separate test APK.

## Two-device sync

The `sync` command requires two distinct disposable Android devices, the E2E APK
and native target fixture on both, and local Pusher-compatible signaling with
authenticated TURN. It captures the actual invitation export, copies identical
bytes to the receiver, starts the sender and completes linking and recovery-code
setup with a different receiver master password. It checks the transferred
credential, bidirectional edits including password changes, and restart
persistence on both devices.

Server setup uses **Link a device → Create invitation → Connection options →
Manage custom servers**, then returns to Devices before creating the transfer
invitation.

After each edit, the journey invokes the linked device's existing **Sync now**
control. Automatic sync on connection opening does not imply continuous push
for later edits. The setup selects **Auto-lock → Off** through the normal
Security screen on both disposable vaults so coordinated waits and restarts do
not interrupt linking. Security and auto-lock suites retain their own settings.
The sender also opens its saved connection, checks the separate signaling, STUN
and TURN roles, edits and discards the display name, and verifies that reopening
settings retains the original name before synchronizing.

Generate short-lived private configuration from local Online Services settings
and keep the file outside the repository:

```sh
export E2E_SYNC_CONFIG=/path/outside-checkout/sync-e2e.json
node mobile/e2e/fixtures/sync-config.mjs "$CLOUD_ENV_FILE" "$E2E_SYNC_CONFIG"
E2E_SYNC_SENDER=emulator-5554 E2E_SYNC_RECEIVER=emulator-5558 \
  pnpm mobile:e2e -- sync
```

The environment file must provide `NEXT_PUBLIC_PUSHER_APP_ID`,
`NEXT_PUBLIC_PUSHER_APP_KEY`, `PUSHER_APP_SECRET` and `TURN_AUTH_SECRET`.
Signaling defaults to localhost:6011; the runner reverses that port on both
devices. TURN defaults to `10.0.2.2:3478`; `E2E_TURN_HOST` overrides it. TURN
credentials expire after one hour. Regenerate configuration for later runs.

If no local TURN server exists, run `node mobile/e2e/fixtures/start-turn.mjs
"$CLOUD_ENV_FILE" HOST_LAN_IPV4` to start a dedicated coturn container. Its output
includes cleanup instructions. The local backend on port 3001 and web app on port
3000 can also be used for manual web/mobile linking with disposable vaults.

`sync-sender` and `sync-receiver` are constituent phases; use `sync` for the
coordinated journey. The phases need the private environment supplied by the
sync runner. An explicit `--device` overrides its sender selection.

## Cloud fixture

Build the E2E APK against the included loopback fixture:

```sh
EXPO_PUBLIC_CLOUD_ENABLED=true \
  EXPO_PUBLIC_ONLINE_SERVICES_API_URL=http://localhost:43111 \
  EXPO_PUBLIC_TURNSTILE_SITE_KEY='' pnpm mobile:build -- --e2e
pnpm mobile:e2e -- cloud --device emulator-5554
```

The cloud command starts the disposable fixture when its port is free, or reuses
an existing instance after checking its identity. It refuses another service on
that port. It reverses the selected device's port and stops only a fixture it
started. `CRYPTEX_E2E_CLOUD_PORT` changes the port; the APK must use the matching
URL. `pnpm mobile:e2e -- cloud-fixture` runs the fixture manually.

The fixture verifies real signed authentication challenges and upload checksums,
rotates refresh tokens and stores actual encrypted backup bytes in memory.
Disposable accounts receive backup entitlement. The cloud journey creates an
account, saves its Recovery Kit, enables backups, uploads an encrypted vault,
inspects backup history and deletes its snapshots. Production accounts and
storage are not used. Host contract tests live in
`fixtures/online-services.test.mjs`.

## Account devices fixture

Use the same loopback APK configuration as the cloud suite, then run
`pnpm mobile:e2e -- devices --device emulator-5554` on a disposable phone-sized
emulator. The runner starts a separate fixture scenario that seeds two account
peers and a recorded relationship after real registration and signed login.
Stop an existing cloud fixture before switching scenarios; the runner checks
its health response and rejects a scenario mismatch.

The flow opens both device and connection sheets, checks the map legend and its
animation toggle, switches between Connections and List, checks Cancel and the
sheet's Back button return to the originating view, and dismisses device details
with Android Back. It verifies that account-only
relationships have no invented local sync controls and that exactly one unlink
scope is selected. It also creates and cancels a root invitation, checks temporary
registration cleanup, searches by device ID, promotes and demotes a peer, unlinks
a relationship while preserving its account device, removes that device, checks
the last-root guard, and demotes the current device. The two-device sync suite
separately covers live transport and local link controls. Both suites dismiss the
phone's details sheet explicitly.

## Hosted billing against Stripe TEST mode

This is a separate live test using the real Online Services API and Stripe TEST
mode, not the entitled cloud fixture above. Use a disposable vault/account and a
dedicated emulator. Confirm the backend uses TEST keys and TEST prices, and that
Stripe CLI forwards TEST webhooks to its `/api/payments` route. Do not copy keys,
tokens, recovery phrases or provider session URLs into committed test files.

Run the web app on port 3000 and the backend on 3001. The backend's
`NEXT_PUBLIC_APP_URL` must point to the web app (`http://localhost:3000` here),
which serves both the mobile Turnstile bridge and `/billing/return`. Register through the normal mobile UI;
local captcha testing requires Cloudflare's official test keys in both apps.

```sh
export MAESTRO_DEVICE=emulator-5554
export CRYPTEX_E2E_PROTECTED_DEVICE=protected-device-serial
EXPO_PUBLIC_APP_URL=http://localhost:3000 \
  EXPO_PUBLIC_ONLINE_SERVICES_API_URL=http://localhost:3001 \
  EXPO_PUBLIC_CLOUD_ENABLED=true \
  pnpm mobile:build -- --e2e --profile production
adb -s "$MAESTRO_DEVICE" install -t mobile/android/app/build/outputs/apk/e2e/app-e2e.apk
adb -s "$MAESTRO_DEVICE" reverse tcp:3000 tcp:3000
adb -s "$MAESTRO_DEVICE" reverse tcp:3001 tcp:3001
```

Use `--regenerate-native` when the existing native project belongs to a different
profile, following the mobile README's backup instructions. For preproduction,
use `--profile preprod` for the build and its matching package. The fixed return
targets are `mobile-production` (`cryptex`) and `mobile-preprod`
(`cryptex-preprod`); never configure an arbitrary return URL.

Verify these steps through the app and the actual system browser:

1. Create a fresh vault, register Online Services, acknowledge the Recovery Kit,
   and record the initial **Standard** membership.
2. Choose **Monthly**, tap **Upgrade membership**, and confirm hosted Stripe
   **Sandbox** checkout at the configured monthly price. Use Stripe's merchant
   Back control; it must return to the app with membership still Standard.
3. Set vault auto-lock to **1 minute**, choose **Yearly**, open checkout, and leave
   the browser active for more than 65 seconds. Cancel through Stripe, unlock
   with the vault's actual master password, and confirm return to Account.
4. Submit a monthly TEST payment using Stripe's public test card
   `4242 4242 4242 4242`, a valid future expiry, synthetic name/email and test CVC.
   Confirm browser return (unlock if needed), then **Premium**, renewal details,
   **Manage membership**, and **Your membership is active.** Verify the matching
   paid TEST webhook and subscription in the backend; a return query alone is
   never payment evidence.
5. Open **Manage membership**, confirm Stripe Customer Portal **Test mode** and
   the paid subscription, then use its merchant Return control. The app must
   return to Account and refresh membership.

Store generated APKs, XML/screenshots and private backend evidence outside Git.
Remove the owned device's reverses and stop it after testing, preserving AVD
data; restore any temporary backend URL configuration.

## Passkey suite

Use an Android 14/API 34 or newer physical device with a current browser. From
Cryptex Vault's More → Autofill screen, select **Passkey provider** and enable
Cryptex Vault once before running the suite. Start the local fixture
server and expose port 43110 to the device using the same setup as the
conventional browser tests.

Older emulator Chrome builds may use a legacy Google Play Services passkey
path that does not offer third-party credential providers. When upgrading
Chrome, install its matching Trichrome library first to avoid a missing
shared-library error. Install both only on the selected disposable device:

```sh
adb -s "$MAESTRO_DEVICE" install -r /path/to/TrichromeLibrary.apk
adb -s "$MAESTRO_DEVICE" install -r /path/to/Chrome.apk
```

Set `MAESTRO_DEVICE` to the intended device ID before running
`pnpm mobile:e2e -- passkeys`. The command fails closed when no device is specified
so a second connected device cannot be selected accidentally. The suite runs
one ordered Credential Manager journey so each step uses credentials created by
the previous step. It covers:

- two ES256 discoverable passkey registrations and encrypted-vault persistence;
- `allowCredentials` filtering and selection between multiple discoverable
  accounts;
- direct assertion after Android has already selected an exact passkey;
- `excludeCredentials` returning `InvalidStateError` for a duplicate;
- user cancellation returning control to the requesting browser;
- a locked-vault authentication action followed by assertion;
- passkey account metadata in vault search and the RP ID in item details;
- browser verification of ES256 signatures, challenges, exact origin, RP hashes,
  user verification, credential identity and counters.

System credential-provider screens vary by device vendor, so the one-time
provider enablement remains an explicit physical-device prerequisite rather
than a non-idempotent Maestro tap. The emulator runner supplies the enrolled
fingerprint for each ceremony. On physical devices, run the Maestro flow directly
and approve prompts manually; the biometric helper accepts only emulator serials.
`tests/android-passkeys.test.ts` checks WebAuthn encoding, signatures, malformed
input, RP and credential filtering, duplicate exclusion and caller-client-data
hashes.

## Manual acceptance

Run these checks on disposable vaults before release, including a physical
device. Use [the autofill acceptance matrix](AUTOFILL_PHYSICAL_DEVICE.md) for
provider and browser checks.

- Exercise first-time Create, Restore and Link on small screens, with larger
  text and TalkBack. Keep each focused field above the keyboard; check Next/Done,
  reveal/hide, cursor position and remasking on blur or background.
- Stage an initial import, inspect its preview, remove or replace it, then create
  the vault and check the imported items. Try malformed files and cancellation.
- Restore local and managed backups, then unlock with password and recovery code.
  Check wrong credentials, unsupported protection factors, recovery reset and
  interruption without replacing an existing local vault.
- Receive a link by QR, file and paste. Scan with a physical camera, deny camera
  permission, cancel the file picker, and try malformed invitations and wrong
  phrases. Check sender-not-started guidance and transfer interruption.
- Complete a two-device transfer, acknowledge linked recovery details, save,
  relaunch and unlock with the receiver's password and recovery code. Cancel or
  terminate the process after transfer and during recovery acknowledgement;
  check that the saved state and recovery choices remain understandable.

## Results

Maestro JUnit reports are written to `mobile/e2e/results`. Native JVM and
instrumentation reports are under the credentials module's generated
`android/build` directory. Record the source revision, APK identity, device and
suite with each run; rerun affected journeys after profile or native changes.
