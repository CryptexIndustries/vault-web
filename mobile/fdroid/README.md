# F-Droid source preparation

The submission package is `metadata/com.cryptexindustries.vault.yml` plus
`srclibs/LightningCSS.yml` and `srclibs/GN.yml`. The recipe reuses F-Droid's
existing `esbuild`, `skia` and `OpenSSL` definitions. It builds an unsigned
production APK while
keeping Online Services available and disabling Expo OTA. The submission needs
the complete public release commit and developer-signed reference APK URL.
The public configuration is at `mobile/release-config.json` in that commit.
F-Droid packager review and build-server acceptance remain
external steps. Listing files are at checkout-root `fastlane/metadata/android`.
The metadata declares `NonFreeNet` for optional Turnstile, Stripe and Backblaze use.

To prepare the first submission, replace `PUBLISH_RELEASE_COMMIT` in the
fdroiddata copy with the full commit hash behind `mobile-v0.1.0`.
CI fills this value in its submission artifact.
Publish the developer-signed `cryptex-vault-fdroid.apk` and `release-config.json`
assets on the matching GitHub release. The build has no `disable` flag.
`AutoUpdateMode: Version` uses the release tag selected by `UpdateCheckMode`.
The mobile-only tag/app.json checks select new versions. Each release still needs
its signed APK at the corresponding release URL. The configuration comes from
the source checkout; its published copy is included for verification.

## First release source

Before tagging `mobile-v0.1.0`, commit `mobile/`, its referenced `patches/` files,
the mobile validation and F-Droid workflows, and `fastlane/metadata/android/`.
Include the root package, pnpm workspace and lockfile, Git ignore rules and Jest
configuration needed to build and check the app.

The release also needs these shared changes:

- `packages/api-contract/src/payment.ts` and `src/routes/v1/payment.router.ts`.
- `packages/shared-ui/package.json` and `src/lib/{device-topology,recovery-kit-utils}.ts`.
- `packages/vault-core/package.json`, `src/{credential-url,synchronization,sync-operations}.ts`,
  `src/internal/envelope-crypto.ts` and
  `src/vault-utils/{envelope-encryption,linking,vault,ice-candidate-discovery}.ts`.

Include their credential-URL, ICE discovery, linking lifecycle, synchronization
lifecycle and sync-operation regression tests.

The Stripe return flow needs `web/src/lib/billing-return.ts`,
`web/src/pages/billing/return.tsx` and its test. The API contract here is separate
from the deployed backend implementation.

Unrelated web documentation, Next configuration and extension store-listing
changes are outside this release scope. Keep generated native trees, dependency
caches, private signing material and raw store-listing recordings out of the
source commit. Publish APKs as release assets.

## Release CI

[Mobile](../../.github/workflows/mobile.yml) runs checks on relevant pushes to
`development` or `master` and on pull requests. Android smoke tests and release
builds run only on manual dispatch or `mobile-v*` release tags.

Manual dispatch defaults to `preprod` and builds the selected branch using the
`Mobile - Preproduction` GitHub environment. Selecting `production` requires
dispatch on an existing `mobile-v` tag matching `app.json`. Pushing that tag
automatically selects production and calls
[Mobile F-Droid](../../.github/workflows/mobile-fdroid.yml) after checks and smoke tests.
The F-Droid workflow compiles and scans the complete recipe inside the pinned
official build-server container, including all four Android ABIs.

GitHub requires `mobile.yml` on the default branch before manual dispatch is
available. Tag runs use the workflow in the tagged commit.

```sh
gh workflow run mobile.yml --ref development -f profile=preprod
gh workflow run mobile.yml --ref mobile-v0.1.0 -f profile=production
```

Production and F-Droid builds read `mobile/release-config.json`; preproduction
builds read `mobile/prerelease-config.json`. Both public configurations are
versioned with the source.

Separate signing jobs consume the verified unsigned APK and the exact
configuration snapshot from the build job. They use environment secrets
`CRYPTEX_KEYSTORE_BASE64`, `CRYPTEX_KEYSTORE_PASSWORD` and `CRYPTEX_KEY_PASSWORD`.
The alias comes from the public signing identity. Signing uses build-tools 34,
checks the certificate pin and APK policy, and never rebuilds the application.

The `mobile-preprod-release-<run-id>` and `mobile-fdroid-release-<run-id>` artifacts
contain signed and unsigned APKs, public configuration, verification receipts and
checksums. `mobile-fdroid-submission-<run-id>` contains scanner/build logs and
submission metadata with the exact source commit and srclib definitions.

Publish `cryptex-vault-fdroid.apk` and its `release-config.json` from the production
artifact on the matching GitHub release before submission. F-Droid uses
`Binaries` to compare our signed APK with its independent source build.
GitHub Actions artifacts prepare the release; publishing it remains a separate step.

## Inputs that survive Expo prebuild

- `dependencies.gradle` fixes React Native SDK placeholders, rejects dynamic
  Maven versions and rejects forbidden external runtime artifacts. Source-built
  Expo project substitutions are allowed. Apache-2.0 TensorFlow metadata tooling
  on the Android Gradle Plugin build classpath is checksum-verified, not packaged.
- `verification-metadata.xml` checks artifact and Maven metadata SHA-256 values.
  The Expo plugin copies it into generated `android/gradle`.
- `npm-cleanup.json` names unused binaries and host compilers rebuilt from source,
  at exact reviewed package versions.
  A dependency update needs a fresh inventory and scanner run.
- `checkout-cleanup.json` names the unused web-only WASM asset outside npm.
- `npm-source-edits.json` removes obsolete local dependency and publishing
  repositories from 12 exact npm versions. Original and prepared file checksums
  are required. Atomic replacement preserves any hardlinked pnpm cache copy.

Normal builds must keep strict dependency verification. To review an intentional
update, generate candidate metadata in an isolated checkout using the actual
publication build tasks and `--write-verification-metadata sha256`. Review the
diff and the artifacts' source/licenses before copying the new metadata here.
Do not regenerate checksums automatically in release CI.

## Isolated source cleanup

Install the mobile dependency graph from the frozen lock in the packager's
isolated checkout. Keep its pnpm virtual store inside that checkout; do not
symlink another checkout's installed `node_modules`. Expo prebuild must run before cleanup because it uses
`expo/template.tgz`.

```sh
export JAVA_HOME=/absolute/path/to/pinned-temurin-17
export ANDROID_HOME=/absolute/path/to/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export CRYPTEX_GRADLE_COMMAND=/absolute/path/to/gradle-9.3.1/bin/gradle
pnpm install --frozen-lockfile --ignore-scripts --filter mobile...
node mobile/fdroid/build.mjs prebuild
```

The prebuild phase generates native sources once, records the release provenance
and applies the reviewed cleanup. The build phase retains that recorded source
revision for Expo configuration, even when cleanup removes a tracked unused file.
For a read-only cleanup inventory, run
`node mobile/fdroid/prepare-source.mjs --checkout /absolute/isolated-checkout`.
Unknown archives remain visible to the scanner. Cleanup validates the entire plan
before mutation and refuses symlink targets, external dependency stores and
unreviewed source contents. It also rejects unreviewed native Node addons before
mutation, because fdroidserver 2.4.5 misses non-executable `.node` files.

Run `fdroid scanner` with the actual app metadata/build recipe after cleanup.
Do not add blanket `scanignore` entries for `node_modules`, native archives or
Android modules. The official Hermes compiler is a permitted binary toolchain;
the recipe excludes only its exact Linux compiler path. The scanner deletes
Gradle wrappers, so the build phase uses F-Droid's installed wrapper with the
project's pinned Gradle version.

Android OpenSSL compiles from source. The F-Droid recipe supplies its pinned
`OpenSSL` source library through `CRYPTEX_OPENSSL_SOURCE`; other builds use
the checksum-verified archive pinned in the
[Quick Crypto patch](../../patches/react-native-quick-crypto@1.1.7.patch).
The [APK audit](../scripts/verify-native-crypto.mjs) checks the shipped native libraries.

The recipe uses F-Droid's existing `OpenSSL`, `esbuild` and `skia` source library
definitions. OpenSSL is pinned to its 3.5.8 release commit. esbuild
0.25.12 is compiled from source commit
`208f539945b145e7c9d6d844290f81c3fe5af320` after scanning, using prefetched Go
modules with network access disabled for Go. The recipe
removes unused npm publishing manifests; the Go compiler uses none of them.
Gradle still resolves approved Maven
dependencies under strict checksum verification.

The Android Metro export loads Lightning CSS 1.27.0 through NativeWind; Expo's
1.32.0 web compiler is not loaded. Both npm prebuilts are removed. The required
Node addon is built after scanning from upstream commit
`eb49015cf887ae720b80a2856ccbdf61bf940ef1`, with its locked Cargo dependencies and
upstream-pinned Rust 1.76.0. Debian's rustup installs this toolchain and the
recipe fetches Cargo sources before scanning. Cargo compilation
then runs offline, and the compiled addon uses Lightning CSS's existing local
fallback loader. The unused dprint, Rollup, oxlint/oxfmt and pnpm platform addons
are also removed at their exact reviewed versions.

After compiler changes, compare Android JavaScript exports and reproduce the
APK from independent source/dependency trees.

The build phase is
`node mobile/fdroid/build.mjs build /absolute/esbuild-source /absolute/lightningcss-source /absolute/skia-source /absolute/gn-source`,
with `CRYPTEX_OPENSSL_SOURCE` pointing to the pinned source library. It never calls
Expo prebuild again. Do not invoke the ordinary staging build helper after
scanner cleanup, since it regenerates a separate native project.
Generate the developer-signed F-Droid reference from this source-built recipe.
The ordinary `pnpm mobile:build --distribution fdroid` path uses npm's Skia
archives and cannot establish equality with the source-built recipe. Local checks
on October 6 passed source-built four-ABI compilation and independent
APK reproduction before later cleanup and animation changes. Reproduce the final
clean release commit across all four ABIs before signing the reference APK.

## Skia Android source libraries

React Native Skia 2.6.2 loads nine Ganesh static archives for each Android ABI.
Its npm package copies these archives from `react-native-skia-android@147.1.0`
at install time. F-Droid cleanup removes both copies, the unused Apple archives,
and CanvasKit's web binaries at their exact package versions.

The recipe pins Skia to `4502f88af90279ad2685528bd3cf7e90ab140f19`, matching
[RN Skia v2.6.2's source submodule](https://github.com/Shopify/react-native-skia/tree/8fabe1e991ed3059b67af21b131d0647e5b71006/externals).
It pins GN to `b2afae122eeb6ce09c52d63f67dc53fc517dbdc8`, matching Skia's
[`bin/fetch-gn` revision](https://skia.googlesource.com/skia/+/4502f88af90279ad2685528bd3cf7e90ab140f19/bin/fetch-gn).
`skia-source.json` records the eleven font/codec commits from the pinned `DEPS`
and reviewed unused source paths. `skia-source.mjs fetch` runs before scanning.
It fetches only these Git sources and validates their commits. It never runs
depot_tools, CIPD, `fetch-gn`, `git-sync-deps` or automatic tool updates.

After scanning, the helper compiles GN with the distribution's C++ compiler and
Ninja, then compiles all four Skia ABIs with the pinned NDK 27.1.12297006.
Its Ganesh flags match the upstream Android configuration, with source/output/NDK
prefix maps added for build paths. Paragraph, SVG, image codecs and skottie remain
enabled. ICU is loaded from Android at runtime; Graphite/Dawn and their build
dependencies are disabled. The unused CMake `pathops` import is never linked;
the upstream nine-archive output list already contains path operations in Skia.
The helper refuses pre-existing npm archive directories, altered tracked source,
unreviewed source deletions, changed bridge CMake inputs and wrong NDK versions.
It writes archive hashes and source pins to `skia-source-build.json` in the build
output directory. Source pins and path maps alone do not establish reproducibility.
`notices/skia-2.6.2.txt` preserves the upstream bridge, Skia and linked codec/font
redistribution notices. The existing Android packaging plugin copies it to
`assets/licenses/` in both distributions. FreeType uses its FreeType License;
the notice file includes its attribution and the Independent JPEG Group notice.

For an isolated single-ABI validation, after fetching and scanning the sources:

```sh
ANDROID_NDK=/absolute/android-sdk/ndk/27.1.12297006 \
  node mobile/fdroid/skia-source.mjs build /absolute/skia-source /absolute/gn-source \
  /absolute/clean-npm-skia /absolute/build-output x64
```

Omit `x64` to build all four ABIs. The F-Droid recipe always builds all four.
Keep isolated dependencies and build outputs separate from the development
checkout; source cleanup must never run on the live pnpm store.

## Signature verification runtime

Use `apksigcopier` 1.1.1 in a separate venv created with `python3.12`, tested with
Python 3.12.13. Python 3.13.14 changes ZIP header flags and breaks exact signature
reconstruction. This verification runtime is outside APK compilation; the
tool does not change the embedded build toolchain.

Standard releases retain Expo's random embedded UUID and current timestamp;
the [reference reproduction workflow](../README.md#build-and-install-an-apk)
replays the signed reference's UUID and exact millisecond timestamp, then requires
full APK byte equality. F-Droid builds use a deterministic embedded UUID
derived from reviewed release metadata and timestamp zero, since OTA is disabled.
Keep generated APK hashes and runtime fingerprints in ignored
`mobile/dist/*.apk.json` sidecars or local verification reports. Dependency
checksums, toolchain pins and accepted signing certificates remain source inputs.

## Local helper tests

```sh
node --test mobile/fdroid/*.test.mjs
```

The cleanup tests use disposable fixtures. The dependency regressions use the
installed mobile graph to check URL decoding and the patched build-tool APIs.

The CLI suite also checks native path maps with the pinned Android NDK and
CMake when `CRYPTEX_NATIVE_TEST_SDK` points to an installed SDK:

```sh
CRYPTEX_NATIVE_TEST_SDK=/absolute/path/to/android-sdk pnpm mobile:check -- cli
```

Android CI supplies this SDK path. Without it, the Android fixture reports an
explicit skip; host compiler tests do not substitute for the pinned toolchain.

The separate offline Gradle check exercises source substitution, external binary
rejection, SDK pinning and dynamic-version rejection without downloading artifacts:

```sh
CRYPTEX_GRADLE_COMMAND=/absolute/path/to/gradle-9.3.1/bin/gradle \
  node mobile/fdroid/check-dependency-policy.mjs
```
