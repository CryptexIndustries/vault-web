# Cryptex Vault mobile

Expo and React Native app. Vault crypto and synchronization use the shared
`@cryptex-industries/vault-core` package. Licensed under AGPL-3.0-only.

Run the commands below from the repository root.

## Setup

Use the pinned Node, pnpm, Temurin JDK and Android SDK versions in
[fdroid/toolchain.json](fdroid/toolchain.json).

```sh
pnpm install
cp mobile/.env.example mobile/.env
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb devices
export ANDROID_SERIAL=emulator-5554 # Replace with the device serial from adb devices
```

Development settings live in `mobile/.env` or `mobile/.env.local`:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_CLOUD_ENABLED` | Set to `false` for local-only development |
| `EXPO_PUBLIC_APP_URL` | Web app and Turnstile host |
| `EXPO_PUBLIC_ONLINE_SERVICES_API_URL` | tRPC API base URL |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | Captcha for account registration and recovery |
| `EXPO_PUBLIC_PUSHER_*` | Signaling configuration |

## Development

Native modules require a custom development client. Build and install it before
starting Metro:

```sh
pnpm mobile:build -- --dev
adb -s "$ANDROID_SERIAL" install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
pnpm mobile:dev
```

Rebuild after changing native dependencies or plugins. Add `--profile preprod`
to both build and dev commands to use the preproduction identity. If an existing
Android project uses a different identity, add `--regenerate-native` to the build.
The helper backs up the old tree under
`$HOME/.cache/cryptex-development/native-backups/`. Keep native changes in
`mobile/plugins/` and `mobile/modules/`.

For iOS, run `pnpm --dir mobile exec expo prebuild --platform ios --no-clean`,
then `pnpm --dir mobile ios`. The release build helper targets Android.

## Build and install an APK

| Profile | Application ID | Public configuration | Signed APK |
| --- | --- | --- | --- |
| `production` | `com.cryptexindustries.vault` | `mobile/release-config.json` | `mobile/dist/cryptex-vault.apk` |
| `preprod` | `com.cryptexindustries.vault.preprod` | `mobile/prerelease-config.json` | `mobile/dist/cryptex-vault-preprod.apk` |

The profiles can coexist on one device. Release builds use the selected public
JSON and ignore local dotenv files. `--config <path>` replaces the entire JSON;
use the same file for build, install verification and OTA updates.

Signed builds require the approved profile's keystore. The helpers load
`signing.env` from `$HOME/.local/share/cryptex-vault/signing/` for production or
`$HOME/.local/share/cryptex-vault/signing-preprod/` for preproduction. Restore that
directory from your encrypted backup on a new machine. Public certificate pins
are in `release-signing.json` and `release-signing-preprod.json`.

```sh
pnpm mobile:doctor
pnpm mobile:build
pnpm mobile:install -- --device "$ANDROID_SERIAL"
pnpm mobile:logs -- --device "$ANDROID_SERIAL"

pnpm mobile:doctor -- --profile preprod
pnpm mobile:build -- --profile preprod
pnpm mobile:install -- --profile preprod --device "$ANDROID_SERIAL"
```

Standard builds reuse a gitignored `.mobile-build/` workspace inside the current
checkout. This applies to both profiles. JavaScript edits keep the native build
outputs; dependency or native configuration changes refresh the affected inputs.
The first build in a new worktree is cold. Removing `.mobile-build/` discards only
the local build cache.

All four Android architectures are included by default. Choose one with `--arch`
and use the same option when installing its APK:

```sh
pnpm mobile:build -- --profile preprod --arch arm64-v8a
pnpm mobile:install -- --profile preprod --arch arm64-v8a --device "$ANDROID_SERIAL"
```

Accepted targets are `all`, `armeabi-v7a`, `arm64-v8a`, `x86` and `x86_64`.
Targeted APK names include the architecture, for example
`mobile/dist/cryptex-vault-preprod-arm64-v8a.apk`.

Local builds use all available CPUs for Gradle, native compilation, OpenSSL and
Metro. The JVM chooses its memory budget from the available memory, without the
old fixed heap and metaspace limits. Set `--jobs <count>` to limit parallelism or
`--heap <MiB>` to set the Gradle heap explicitly:

```sh
pnpm mobile:build -- --profile preprod --jobs 4 --heap 4096
pnpm mobile:build -- --profile preprod --clean
```

`--clean` creates an independent workspace, disables compiled build caches and
uses the pinned reproduction resource settings. Release CI passes this flag.
You can also request a fresh local build with `--clean --jobs auto`.
`--reproduce-from` and F-Droid builds always use fresh workspaces, all four
architectures and pinned resource settings.

`logs` requires the selected app to be running. Build output includes an
`<APK>.json` record with the source revision, configuration, signer and native
runtime. Signed builds also retain an aligned unsigned APK.

```sh
pnpm mobile:build -- --profile preprod --config /absolute/path/to/public.json
pnpm mobile:build -- --unsigned
pnpm mobile:build -- --distribution fdroid --unsigned
pnpm mobile:signing -- setup --profile preprod
```

`--unsigned` requires no private APK signing key. `signing setup` creates a new
identity and refuses an existing destination; back it up before distributing
APKs. `--offline-services` disables Online Services in the initial bundle.
Standard builds still receive OTA updates that can change that setting.

`--distribution fdroid` disables OTA and keeps Online Services available.
For F-Droid source cleanup and packaging, follow [fdroid/README.md](fdroid/README.md).

To reproduce a signed release, use the same source, toolchain, profile and public
configuration as the reference. Use the pinned Python and apksigcopier versions
in [the verification runtime instructions](fdroid/README.md#signature-verification-runtime).

```sh
export CRYPTEX_REPRODUCTION_PYTHON=/absolute/path/to/verification-venv/bin/python
pnpm mobile:build -- --reproduce-from /absolute/path/to/release.apk
```

Add the reference's `--profile`, `--config`, `--distribution` and
`--offline-services` options when applicable. Reproduction uses the reference's
public signature and embedded update identity, then checks exact APK bytes.

## Checks and device tests

`mobile:check` runs lint, types, unit tests, CLI tests and a temporary Android
JavaScript export. Select an individual check as follows:

```sh
pnpm mobile:check
pnpm mobile:check -- lint
pnpm mobile:check -- types
pnpm mobile:check -- unit --runInBand
pnpm mobile:check -- cli
pnpm mobile:check -- export

pnpm mobile:build -- --e2e
adb -s "$ANDROID_SERIAL" install -r -t mobile/android/app/build/outputs/apk/e2e/app-e2e.apk
pnpm mobile:e2e -- smoke --device "$ANDROID_SERIAL"
pnpm mobile:e2e -- crypto --device "$ANDROID_SERIAL"
pnpm mobile:e2e -- --help
```

Device tests require `--device`, `ANDROID_SERIAL` or `MAESTRO_DEVICE`.
`--e2e` builds the test APK with screenshot access for Maestro.
See [e2e/README.md](e2e/README.md) for fixtures and suite setup.

## OTA updates through EAS

Standard builds use the profile's EAS channel. F-Droid builds disable OTA.
Native module, plugin, permission or certificate changes require a new APK.
OTA updates replace Android JavaScript and assets on a later launch.

```sh
pnpm mobile:ota -- preflight --profile preprod
pnpm mobile:update -- --profile preprod --message "Login fix" --dry-run
pnpm mobile:ota -- export --profile preprod
```

These commands run locally. Export defaults to `mobile/dist/ota-<profile>` and
writes a configuration and runtime record beside it.

Before publishing, authenticate and check the project's channels:

```sh
pnpm --dir mobile exec eas login
pnpm --dir mobile exec eas project:info
pnpm --dir mobile exec eas channel:view preprod --json --non-interactive
pnpm --dir mobile exec eas channel:view production --json --non-interactive
```

Create a missing channel with
`pnpm --dir mobile exec eas channel:create <profile> --non-interactive`.
Each channel must map entirely to its same-named branch.

```sh
pnpm mobile:update -- --profile preprod --message "Login fix"
pnpm mobile:update -- --profile production --message "Login fix" --percentage 10
pnpm mobile:ota -- rollout --profile production --group "<group-uuid>" --percentage 100
pnpm mobile:ota -- rollback --profile production --group "<group-uuid>" --message "Revert login fix"
pnpm mobile:ota -- rollback --profile production --runtime "<native-runtime>" --message "Use embedded bundle"
```

Use the group UUID from publication output and the native runtime from About or
the APK's JSON record.

`mobile:update` runs `mobile:ota publish`. Publication defaults to 10% rollout
for production and 100% for preprod. All actions accept `--profile` and
`--config`; mutation actions accept `--dry-run`. Rollback requires stored vault
data to remain readable by the earlier code.

For signed update manifests, generate the profile's key with
`pnpm mobile:ota -- setup --profile preprod --generate-keys`, set
`EXPO_PUBLIC_OTA_SIGNING_ENABLED` to `"true"` in its public JSON, then rebuild
the APK. Private keys live under `$HOME/.config/cryptex-vault/ota/<profile>/`;
public certificates live in `mobile/config/ota-certificates/`. Signed mutations
require `--signing-plan-confirmed` and a signing-capable EAS plan.
The default `"false"` uses unsigned update manifests.

## Local services on Android

For local web, API, signaling and Garage storage services, copy the corresponding
public settings into `mobile/.env.local` and forward their ports:

```sh
adb -s "$ANDROID_SERIAL" reverse tcp:3000 tcp:3000
adb -s "$ANDROID_SERIAL" reverse tcp:3001 tcp:3001
adb -s "$ANDROID_SERIAL" reverse tcp:6011 tcp:6011
adb -s "$ANDROID_SERIAL" reverse tcp:3900 tcp:3900
```

Development HTTP is allowed for `localhost`, `garage.localhost`, `127.0.0.1`
and `::1`. Use HTTPS for other hosts.

## Further documentation

- [Android autofill](docs/ANDROID_AUTOFILL.md) and [passkeys](docs/ANDROID_PASSKEYS.md)
- [Android PRF feasibility](docs/ANDROID_PRF_FEASIBILITY.md)
- [QR scanner maintenance](QR_SCANNER.md)
- [Security threat model](threat-model.md)
- [F-Droid source builds](fdroid/README.md)
- [Asset licenses](ASSET_LICENSES.md)
