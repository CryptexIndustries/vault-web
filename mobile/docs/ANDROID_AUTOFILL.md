# Android conventional autofill

The Android implementation lives in the local
`cryptex-android-credentials` Expo module and uses `AutofillService` on API 26
and newer. Password and TOTP behavior is separate from Credential Manager
passkeys.

Use Android password autofill first. Chrome, Brave, and Vivaldi may also need
their browser setting for third-party autofill enabled; the app shows the
available switches under Settings > Autofill > Browser integrations. For a
browser request, the service uses a field's reported website when available,
excludes fields that report a different website, and declines a request if no
website is available. If Android does not report the receiving field's website,
the app asks for a separate review before filling.

## Accessibility fallback

An optional `AccessibilityService` covers login surfaces that do not expose
the Autofill Framework. It is independently enabled in Android Accessibility
settings and is never required for normal autofill or passkeys. While enabled,
the service uses editable-field labels and input metadata to offer a small
Cryptex Vault button. The user must then explicitly choose **Autofill login**
or **Save login**.

The fallback does not continuously capture form text. Available form values are
read only after **Save login** is selected, and the standard in-app review must
be confirmed before the vault changes. Android normally redacts password text
from accessibility services; when that happens, the review explains why and
requires the password to be entered again inside Cryptex Vault. Vault plaintext
is released only after **Autofill login** is selected and the normal vault
timeout check succeeds.
Pending fill values are kept in memory for no more than three seconds while
the original app resumes, then discarded. Clipboard-based filling is not used.

Browser requests require a readable address bar in an explicitly supported
browser and are revalidated against the active package and reported website
immediately before filling. If the browser hides the HTTP(S) scheme, Cryptex
marks the connection as unverified, offers no automatic saved-login matches,
and requires manual selection and destination review. It never assumes that a
bare host means HTTPS. If the service cannot determine a browser host, it does
not offer a request and never substitutes `androidapp://browser.package` for a
website. This extracted website does not identify each receiving field's
document or iframe origin.
Every browser accessibility fill requires a separate in-app destination review,
even when a saved login matches the address bar. The review shows the browser
address, but cannot verify an embedded field's origin. The threat model records
the decision to keep this optional fallback.
Browser package names do not prove publisher identity; the threat model records
that compatibility decision separately. See the [mobile application threat model](../threat-model.md#123-password-and-totp-autofill)
for current controls, residual risk, and outstanding validation. Native apps
use exact package associations and retain the existing per-fill unverified-app
warning. The service never offers itself on Cryptex Vault screens.

For explicit saves, separate email and username fields remain separate, new
password fields take precedence over current-password fields, and mismatched
readable new-password/confirmation values are rejected. Apps that redact
password text from accessibility can still use fallback saving after the user
re-enters that one protected value in the vault review.

## Request lifecycle

1. The service inspects Android autofill hints, HTML autocomplete attributes,
   input types, and conservative field-name heuristics.
2. It returns an authenticated dataset containing no vault plaintext.
3. Selecting the dataset opens the non-exported relay activity. The request
   stays in a private native registry; the intent carries only a random lookup
   handle. If Android kills the app process, the request is canceled rather
   than reconstructed from launcher extras.
4. Warm-app requests are also delivered through a native event, and an accepted
   request gets a fresh 60-second completion window so unlocking cannot discard
   it during normal use.
5. The React Native request screen unlocks the existing vault session, applies
   the shared URI matcher, and either completes a unique trusted match or asks
   the user to select a login.
6. The relay activity returns the completed dataset to the original Android
   autofill session.

Request objects expire after 60 seconds. The native layer never persists
usernames, passwords, TOTP secrets, detected domains, or form values; save-form
values exist only in the short-lived in-memory request. Exported launcher
intents cannot supply a request or receive the relay result. The synchronous
auto-lock guard prevents a resume-time race from
releasing a credential after the configured vault timeout.

## Matching and warnings

Browser hosts use the shared exact-host, parent-domain, and wildcard rules.
Ports are ignored because Android browser structures do not report them.
These matching rules apply only when the browser reports an explicit HTTP(S)
scheme. A scheme-less address can still be filled manually after the warning
and confirmation, but it cannot match or add a saved website association.
Application associations use an exact `androidapp://package.name` rule and
never cross into web matching.

Native app associations, untrusted embedded web contexts, and browser
accessibility fills require explicit confirmation every time. Confirmation is
deliberately not remembered. A user
may search the full vault, but filling an item that does not match the detected
target also requires confirmation.

When a user selects an unmatched login for a native app, they can either fill
it once or fill and remember the app. Remembering appends the exact
`androidapp://package.name` target to the credential and persists that change
before releasing the login. It does not suppress the per-fill application
safety confirmation. Website targets never fall back to the containing browser
or WebView package association.

## Save and TOTP behavior

Password fields are required for Android save requests; usernames are optional.
Registration confirmation fields are included, compatibility-mode password
saves are rejected, and Android's save consent opens an explicit Cryptex Vault
review screen before a vault mutation. Matching username/association pairs are
updated; otherwise a new item is created.

When a registration form contains separate email and username inputs, the
explicit username is saved as the login username and the email is saved as an
`Email` custom field. Later fills return each value to its corresponding field.
An email-only login continues to use the email as its username. Browser saves
default the item name to the detected website rather than the browser
application label; native-app saves use the application label.

Final password forms request a save when their tracked fields become invisible.
Registration and password-change forms may also use an explicit submit trigger
when Android exposes a clearly labeled action. Username-only steps delay saving;
their context is merged with the later password step in the same Android task.
This lets Cryptex handle common navigation and multi-screen flows without
requiring the target app to call `AutofillManager.commit()` explicitly.

After a successful login fill, the current TOTP is copied when the setting is
enabled. The existing secret-clipboard policy clears it after 30 seconds if it
has not been replaced.

## Verification

Pure matching and lifecycle policies are covered by Jest. Kotlin and manifest
integration are checked by the Android Gradle build. Maestro flows and the
test-only native target app are under `mobile/e2e`; see
`mobile/e2e/AUTOFILL_PHYSICAL_DEVICE.md` for the physical-device procedure.
The accessibility flow uses test activities that explicitly opt out of the
Autofill Framework, covering fallback fill, TOTP, application association,
explicit save/update review, and locked-vault return.
