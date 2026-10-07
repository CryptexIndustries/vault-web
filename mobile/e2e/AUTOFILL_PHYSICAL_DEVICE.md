# Android autofill physical-device verification

These checks intentionally use a physical Android device. They do not require
or assume an emulator.

## Prepare builds and fixtures

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm mobile:build -- --e2e
pnpm mobile:e2e -- target
pnpm mobile:e2e -- fixture
```

Leave the fixture server running. In a second terminal, select the TCP/IP ADB
device if more than one device is listed, then run:

```sh
adb reverse tcp:43110 tcp:43110
adb install -r -t mobile/android/app/build/outputs/apk/e2e/app-e2e.apk
adb install -r mobile/e2e/fixtures/autofill-target/app/build/outputs/apk/debug/app-debug.apk
```

The E2E build uses the debug keystore and disables main-window screenshot
protection for Maestro. Do not distribute that test APK.

## Run the automated journey

Use Chrome 135 or newer and an inline-capable keyboard. Then run:

```sh
pnpm mobile:e2e -- autofill --device <device-serial>
```

The first setup leg opens Android and Chrome settings. System wording varies by
Android vendor, so if Maestro stops there, manually select **Cryptex Vault** as
the preferred autofill service and enable **Autofill using another service** in
Chrome, then rerun the flow without uninstalling either APK.

## Manual acceptance matrix

Perform these checks after the automated journey so its test vault and native
app association already exist.

1. **Inline and popup presentation**
   - In Cryptex Vault, open Settings → Autofill.
   - Under **Suggestion display**, select **Above keyboard**, focus a login
     username in Chrome, and confirm the Cryptex Vault action appears in the
     keyboard.
   - Select **Popup/dropdown**, refocus the field, and confirm Android shows its
     standard popup/dropdown action instead.
   - Select **Above keyboard** again.

2. **Unique and multiple matches**
   - With one matching login and an unlocked vault, select the Cryptex Vault
     action and confirm the username and password are returned immediately.
   - Add a second login for the same host, retry, and confirm the app opens a
     searchable two-item selection screen rather than choosing for you.
   - Search by name and fill the second item.

3. **Lock timeout**
   - Set auto-lock to one minute, lock and unlock the vault, then leave Cryptex
     Vault in the background for more than one minute.
   - Request autofill and confirm the master-password or biometric unlock is
     required before any credential is returned.
   - Repeat after less than one minute and confirm the vault remains usable.

4. **URI rules**
   - Create exact-host, parent-domain, and safe-wildcard logins using distinct
     usernames.
   - Check the apex host, a sibling subdomain, and a wildcard-covered subdomain.
     Confirm only the rules expected by each match mode appear.
   - Confirm an HTTPS-only saved login is not suggested on HTTP, while an HTTP
     saved login may be suggested after an HTTPS upgrade.
   - Confirm explicit ports do not prevent an Android browser match because the
     framework does not report ports.
   - Confirm a wildcard in a public or registrable suffix cannot be saved.

5. **Native apps and warnings**
   - Open **Autofill Test App** → Login form and choose Cryptex Vault.
   - Confirm a warning names the target app before filling a website login.
   - Cancel once and verify no values are inserted.
   - Confirm and fill, then repeat the request. Verify the warning appears again;
     approval is deliberately not remembered.

6. **Save and update**
   - In both registration fixtures, enter different values in **Email address**
     and **New username**, then submit. Confirm the review uses **New username**
     as the username and also shows the captured email.
   - Save the login, request autofill on the same registration form, and confirm
     the email and username return to their corresponding fields.
   - Open the saved vault item and confirm the separate value appears as an
     `Email` custom field.
   - In the browser fixture, confirm the default login name is the website host,
     not the browser application name. In the native fixture, confirm the
     default name is **Autofill Test App**.
   - Accept Android's save prompt, edit the review fields, and confirm no vault
     item exists until **Save login** is selected.
   - Repeat the browser save with Cryptex Vault already open but locked. Unlock
     from the save request and confirm it returns directly to the same review
     with the entered username and password intact.
   - Submit a changed password for the same username and association. Confirm
     the review screen says **Update**, then verify the existing item changed
     instead of creating a duplicate.
   - Complete **Multi-step registration**, entering the username on the first
     screen and both password fields on the second. Confirm the save review
     contains the username from the earlier screen.
   - The native registration and password-update fixtures deliberately do not
     call `AutofillManager.commit()`. Confirm their save prompts still appear
     after the credential fields disappear.

7. **TOTP handoff**
   - Enable **Copy verification codes** and fill the fixture login.
   - On the next verification-code page, paste and confirm a six-digit current
     code is present.
   - Wait 30 seconds without replacing the clipboard and confirm the code is
     cleared.
   - Disable the option, fill again, and confirm no new TOTP is copied.

8. **Browser coverage**
   - Repeat a fill in every installed browser. Browsers exposing the Android
     Autofill Framework should work directly.
   - For Chrome, Brave, and Vivaldi variants shown in Settings → Autofill,
     verify their separate third-party-autofill status is enabled and that a
     normal login uses the browser's autofill action.
   - With test logins only, open `http://localhost:43110/frame-origin`. It has
     a page form and both visible and off-screen forms from `127.0.0.1`.
     Check the page form and framed form separately. A field that reports a
     different website must not be included in the page fill. If Android does
     not report a field website, confirm Cryptex asks for review before fill.
     Cancel once and verify all fields stay unchanged.
   - For a browser that does not expose Android autofill metadata, enable the
     optional Accessibility fallback, focus a login field, and verify its
     explicit Cryptex Vault button appears only when the browser address is
     readable. On the frame fixture, confirm it always asks for a separate
     browser review. After confirmation, the accessibility path may fill both
     visible forms; record which fields changed. Confirm an unreadable or
     non-HTTP(S) address never falls back to a browser package association.

9. **Accessibility fallback**
   - Read the disclosure under Settings → Autofill, enable the service in
     Android Accessibility settings, and return to confirm enabled status.
   - In an app that has disabled Autofill Framework support, focus a login
     field and choose **Cryptex Vault → Autofill login**. Confirm the normal
     URI/package matching, warning, unlock, and selection behavior is reused.
   - Focus a verification-code field and confirm a selected login with TOTP
     fills the current six-digit code without overwriting unrelated fields.
   - Enter registration values, choose **Cryptex Vault → Save login**, and
     verify email and username on the review screen. If Android protected the
     password, verify the review clearly asks you to enter it again before
     saving. Repeat with a changed password to verify an update rather than a
     duplicate.
   - Enter different new-password and confirmation values and verify Cryptex
     Vault refuses to open save review.
   - Disable the service and confirm its overlay disappears while native
     Autofill Framework behavior remains available.

10. **Failure safety**
   - Kill Cryptex Vault after the Android suggestion appears, select it,
     and confirm the original request is canceled without filling. Request a
     fresh suggestion and confirm it completes after unlock.
   - Leave a suggestion untouched for more than one minute and confirm selecting
     it reports an expired request rather than filling.
   - Confirm Cryptex Vault never offers to autofill its own master-password form.
