# Google Play Android

Play builds use RevenueCat and Google Play Billing for monthly and yearly subscriptions. Existing Android, F-Droid, iOS and web billing stays unchanged. Play has no Stripe fallback or Expo OTA updates. Builds and uploads to Play are separate; this workflow does not upload.

## Configure billing

Create a RevenueCat project and register the profile's package in Play Console and RevenueCat: production uses `com.cryptexindustries.vault`, preproduction uses `com.cryptexindustries.vault.preprod`. Set up Play App Signing and connect Google Play credentials in RevenueCat. Activate monthly and yearly auto-renewing base plans and import them into RevenueCat. One product can contain both base plans. The client supports full-price `P1M` and `P1Y` plans; prepaid, payment-plan and introductory offers need additional UI work.

Play builds read the same committed public JSON as standard and F-Droid builds: `mobile/release-config.json` for production or `mobile/prerelease-config.json` for preproduction. These fields configure Play billing:

| Setting                                        | Value                                                    |
| ---------------------------------------------- | -------------------------------------------------------- |
| `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`        | Public RevenueCat Android SDK key beginning with `goog_` |
| `EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID`   | Monthly Play subscription product ID                     |
| `EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID` | Monthly base-plan ID                                     |
| `EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_PRODUCT_ID`    | Yearly Play subscription product ID                      |
| `EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_BASE_PLAN_ID`  | Yearly base-plan ID                                      |

Keep RevenueCat secret keys and Google service-account credentials outside client JSON and `EXPO_PUBLIC_*` variables.

Play builds require all five fields. Both profile JSON files have them, each with the RevenueCat Android key for its own package. Standard and F-Droid builds drop these fields from their effective configuration. Product prices always come from Google Play; no prices belong in this file.

RevenueCat native linking and its JavaScript dependency graph are enabled only for Play Android. The Play Gradle policy excludes RevenueCat's advertising ID, Block Store and Amazon Appstore modules. Google Play Billing still pulls in `play-services-location`, which declares no permission. Release verification fails if any APK declares location or advertising ID permissions. The shared native-build finalization step calls Play-owned source preparation to remove the excluded SDK, its RevenueCat dependencies and Play-only policy, checksum and billing source files before F-Droid scanning. Files in `mobile/fdroid` keep their existing content and dependency policy; Google dependencies are never allowed there.

The app obtains its RevenueCat App User ID from the protected `v1.payment.revenueCatCustomer` endpoint, checks that billing is enabled, and respects its purchase permission. Account restores remain available when new purchases are disabled. After a purchase or restore, it calls `v1.payment.syncRevenueCat`, then refreshes subscription and configuration. No access is granted locally; the authenticated subscription endpoint remains the authority. Delayed backend confirmation appears as pending membership. RevenueCat's [restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior) is set to Keep with original App User ID, so a subscription stays with the account that bought it. Restoring or buying it again on another account is refused, and the app explains that the subscription belongs to another account.

## Build and sign

Install the [existing Android toolchain and signing setup](../README.md), then run from the repository root:

```sh
pnpm mobile:build:play
pnpm mobile:build:play -- --profile preprod
```

Both commands produce a signed APK and AAB in `mobile/dist/`. Production filenames are `cryptex-vault-play.apk` and `cryptex-vault-play.aab`; preproduction adds `-preprod` before `-play`. Use `--unsigned` without private keys or `--config /absolute/path/to/config.json` for another public configuration. Existing build resource flags remain available.

The existing profile identity signs the local APK and serves as the AAB upload key. Google holds the Play app signing key, so the APK delivered by Play has a different certificate. Register every key that signs APKs outside Play, including the profile's release key used by standard and F-Droid builds, on the Play Console Android developer verification page. Play, standard and F-Droid builds share a package ID, but Android refuses to install one over another with a different certificate. Switching between Play and another distribution requires a vault export, uninstall and reinstall.

Play version codes are the `app.json` `versionCode` times ten. F-Droid ABI builds use the next four codes, so every distribution gets a distinct code and each release is higher than the last.

Pushing a `mobile-v<version>` tag makes the **Mobile** GitHub workflow build Play for production, in parallel with the F-Droid builds and the Android e2e suite. The Play APK and AAB are signed only after e2e passes, and the draft GitHub release waits for them. To build by hand, run **Mobile** with `distribution=play`: preproduction on any branch, or production to rebuild Play on a `mobile-v` tag. Production always needs the tag that matches the app version.

```sh
gh workflow run mobile.yml --ref development -f profile=preprod -f distribution=play
gh workflow run mobile.yml --ref mobile-v0.1.0 -f profile=production -f distribution=play
```

The workflow builds from the selected profile's committed JSON. The build job has no signing keys. A separate job signs with the `Mobile - Production` or `Mobile - Preproduction` environment's `CRYPTEX_KEYSTORE_BASE64`, `CRYPTEX_KEYSTORE_PASSWORD` and `CRYPTEX_KEY_PASSWORD` secrets, the same ones F-Droid uses, then starts the signed APK on an emulator. The alias comes from the profile's committed signing identity.

Download `mobile-google-play-release-<run-id>` from the Mobile run for the signed artifacts and public configuration. Upload the AAB to Play Console manually.

## Validate before release

Use a Play internal testing track and license testers. A matching-package APK can also be sideloaded for [licensed billing tests](https://developer.android.com/google/play/billing/test). Test both plans, restore, cancellation, pending payment, account recovery/switching, vault lock during payment and delayed RevenueCat events. Verify backend membership changes and the Google subscription management link. Purchases from other platforms remain usable when the backend reports them; Google management lists only Google purchases.

To test against a local API, build the E2E variant with Play billing. It bundles JavaScript, allows plain HTTP to `localhost` and keeps the profile's package ID:

```sh
EXPO_PUBLIC_ONLINE_SERVICES_API_URL=http://localhost:3001 EXPO_PUBLIC_APP_URL=http://localhost:3000 \
  pnpm mobile:build -- --e2e --distribution play
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:3001 tcp:3001
```

Set the other public values (Turnstile, Stripe, signaling and the five Play fields) the same way; E2E builds take public values from the environment, not from the profile JSON. The emulator needs a Google account that is a license tester, and the Play copy of the app must be uninstalled first because the certificates differ. RevenueCat webhooks reach a local API only through a public tunnel.

Live purchases and backend integration cannot be validated without the configured Play/RevenueCat accounts. Check the delivered Play signing certificate and listing requirements before publishing.
