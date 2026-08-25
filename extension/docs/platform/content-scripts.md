# Content Scripts

The extension injects an isolated-world autofill bundle and a small main-world
WebAuthn bridge on all `http:` and `https:` pages.

## Manifest injection

```
js: assets/autofill-cs.js (IIFE, vite.config.content.ts)
matches: http://*/*, https://*/*
run_at: document_start
all_frames: false
match_about_blank: false
```

## Runtime gating (`autofill-cs.ts`)

Before bootstrap:

- `isTopFrame()` — refuses subframes (cross-origin `window.top` access failure → false)
- Protocol must be `http:` or `https:`

Service worker enforces `sender.frameId === 0` for `autofill-cs` origin
(`security-utils.ts`). Sub-frame content scripts cannot message SW as autofill-cs
even if injected.

## Autofill subsystem flow

`field-detector.ts` converts the host DOM into stable field groups and assigns
an inline-control mode to each qualified field. `autofill-cs.ts` reconciles that
model with extension iframe UI and owns interaction, filling, repositioning,
cleanup, and save-on-submit.

```mermaid
flowchart TD
    Page["Host page DOM"] --> Bootstrap["bootstrap()"]
    Bootstrap --> Gate{"Top-level HTTP(S)?"}
    Gate -- No --> Stop["Do nothing"]
    Gate -- Yes --> Reconcile["reconcile()"]

    Mutation["DOM mutation<br/>150 ms debounce"] --> Reconcile
    Scroll["Scroll or resize"] --> Reposition["Reposition icons and open panels"]

    Reconcile --> Detect["detectGroups()"]
    Detect --> Groups["FieldGroup[]"]
    Groups --> Mode["getInlineFieldMode(group, field)"]
    Mode -- autofill --> Picker["Mount credential-picker icon"]
    Mode -- generator --> Generator["Mount generator icon"]
    Mode -- null --> None["No control"]
    Reconcile --> Cleanup["Remove stale icons and groups"]

    Picker --> PickerClick["Open picker beside clicked field"]
    PickerClick --> Fill["Retrieve and fill credential or OTP"]
    Generator --> GeneratorClick["Open generator beside clicked field"]
    GeneratorClick --> FillNew["Fill selected password targets"]

    Submit["Captured form submit"] --> Save["Evaluate and stage save prompt"]
```

## Field detection (`field-detector.ts`)

Detection walks the document and open shadow roots; closed shadow roots are not
accessible. It does not read input values. Values are read later only for fill
and save handling.

```mermaid
flowchart TD
    Walk["Walk input elements"] --> Visible{"Visible and writable?"}
    Visible -- No --> Skip["Skip"]
    Visible -- Yes --> Signals["Read type, autocomplete, name, ID,<br/>placeholder, ARIA and label text"]

    Signals --> Excluded{"Search or shipping/billing?"}
    Excluded -- Yes --> Skip
    Excluded -- No --> Password{"type=password?"}

    Password -- Yes --> NewToken{"autocomplete=new-password?"}
    NewToken -- Yes --> NewPassword["newPassword"]
    NewToken -- No --> CurrentToken{"autocomplete=current-password?"}
    CurrentToken -- Yes --> CurrentPassword["password"]
    CurrentToken -- No --> SecretSignal{"API key, token, secret or PIN signal?"}
    SecretSignal -- Yes --> Skip
    SecretSignal -- No --> SignupSignal{"Confirm/new/register signal?"}
    SignupSignal -- Yes --> NewPassword
    SignupSignal -- No --> CurrentPassword

    Password -- No --> OTPToken{"autocomplete=one-time-code?"}
    OTPToken -- Yes --> OTP["otp"]
    OTPToken -- No --> UserToken{"autocomplete=username or email?"}
    UserToken -- Yes --> Username["username"]
    UserToken -- No --> TextHints{"Text/email/tel heuristic?"}
    TextHints -- "Short OTP signal" --> OTP
    TextHints -- "Username/email signal" --> Username
    TextHints -- No --> Skip

    Username --> Container["Choose form or semantic container"]
    CurrentPassword --> Container
    NewPassword --> Container
    OTP --> Container
    Container --> Bucket["Bucket fields by container"]
```

Explicit password autocomplete tokens are intentionally evaluated before
name-based secret-field exclusions. Attribute and label heuristics are secondary
evidence.

### Group qualification

```mermaid
flowchart TD
    Bucket["Container and classified fields"] --> Promote["Promote co-located type=email<br/>when a password exists"]
    Promote --> Signup{"Signup/change-password evidence?"}
    Signup -- "newPassword, 2+ passwords,<br/>or signup context" --> AcceptSignup["Accept signup group"]
    Signup -- No --> OTPOnly{"Strict OTP-only group?"}
    OTPOnly -- Yes --> AcceptOTP["Accept OTP group"]
    OTPOnly -- No --> PasswordOnly{"Password without username?"}
    PasswordOnly -- Yes --> PasswordEvidence{"current-password token<br/>or clear login context?"}
    PasswordEvidence -- Yes --> AcceptLogin["Accept login group"]
    PasswordEvidence -- No --> Reject["Reject"]
    PasswordOnly -- No --> UsernameOnly{"Username without password?"}
    UsernameOnly -- Yes --> UserEvidence{"Explicit username/email/webauthn<br/>or login context, and not newsletter?"}
    UserEvidence -- Yes --> AcceptLogin
    UserEvidence -- No --> Reject
    UsernameOnly -- No --> AcceptLogin

    AcceptSignup --> Stable["Create FieldGroup with stable IDs"]
    AcceptOTP --> Stable
    AcceptLogin --> Stable
```

Field and container `WeakMap` caches preserve IDs across SPA rescans. The group
`anchor` is only a preferred representative; inline controls bind to individual
fields.

### Development diagnostics

Development content-script builds print one collapsed console group per
`detectGroups()` scan:

```text
[Cryptex autofill] field scan: <icons>, <accepted without icon>, <rejected>
```

The group contains separate console tables for accepted and rejected inputs.
Rows show a non-value element description, type/name/ID/autocomplete metadata,
field classification, group identity, the matched classification and group
reasons, and the final `icon:autofill`, `icon:generator`, `accepted:no-icon`, or
`rejected` result. Input values are never read or included in diagnostics.

`vite.config.content.ts` replaces
`globalThis.__CRYTEX_FIELD_DIAGNOSTICS__` with `true` for development builds and
`false` for production builds. Diagnostics currently have no runtime opt-in in
production.

### Per-field inline controls

Controls are mounted per qualified input rather than once per group. The menu
opens beside the exact clicked field and uses that field's classification.

| Field context                                        | Inline control                | Result                                                                   |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| Username, email, or current password in a login flow | Credential picker             | Fills the matching login group                                           |
| OTP                                                  | Credential picker in OTP mode | Generates and fills the exact clicked OTP input                          |
| `new-password` in signup/change-password flow        | Password generator            | Fills only the group's classified new-password fields                    |
| Current password alongside `new-password`            | Credential picker             | Preserves the existing password while new-password fields use generators |

If a signup group contains multiple password fields but none can be classified
as `new-password`, generator controls remain available as a compatibility
fallback and fill those password fields together.

### Picker and generator interaction

```mermaid
flowchart TD
    Click["Click field icon"] --> Kind{"Control mode?"}

    Kind -- autofill --> Resolve["Resolve exact clicked field"]
    Resolve --> State["Get vault state"]
    State --> Locked{"Locked?"}
    Locked -- Yes --> Unlock["Open popup and poll until unlocked"]
    Locked -- No --> Menu["Open picker beside clicked field"]
    Unlock --> Menu
    Menu --> Pick{"Selection mode?"}
    Pick -- OTP --> RequestOTP["GenerateTOTP via service worker"]
    RequestOTP --> ExactOTP["Fill exact clicked OTP input"]
    Pick -- Credential --> RequestSecret["GetCredentialSecret via service worker"]
    RequestSecret --> GroupFill["Fill group's username and current password"]

    Kind -- generator --> GenPanel["Open generator beside clicked field"]
    GenPanel --> SelectPassword["Select generated password"]
    SelectPassword --> HasNew{"Classified newPassword fields?"}
    HasNew -- Yes --> NewOnly["Fill only newPassword fields"]
    HasNew -- No --> PasswordFallback["Fill ambiguous signup password fields"]
```

The picker panel position, reported field kind, OTP mode, and OTP target all
come from the clicked field rather than the group anchor. Normal credential
selection intentionally fills the matching group.

### Field control lifecycle

Detection records every qualified field, but only the active field gets a
control. Focus or pointer interaction moves the single control to that field.
Blur removes it after the browser settles focus, unless its picker or generator
is still open.

The control lives in a closed shadow root and contains no vault data. It is
positioned against the field's viewport rectangle, reserves enough input
padding to keep text clear, and shifts away from existing site controls. The
original padding is restored when the control moves or closes. Resize,
scroll, transition, and animation events keep the active control and panel in
place.

## Injection model

The content script owns the lightweight field control in its isolated world. It
uses extension-origin iframes only for panels with their own UI and message
channel:

| Iframe                    | Purpose                  |
| ------------------------- | ------------------------ |
| `autofill-menu.html`      | Credential picker        |
| `autofill-generator.html` | Password generator       |
| `autofill-save.html`      | Save-login consent panel |

The iframe URLs come from `chrome.runtime.getURL()` and are web-accessible
resources. The field control is not web-accessible.

### Bootstrap handshake

Before loading an iframe, content script registers `{ mountId, nonce, kind }`
with SW (`RegisterAutofillFrame`). Iframe claims nonce (`ClaimAutofillFrame`).
Parent→iframe `init` over `MessageChannel` requires matching `mountId` + `nonce`.

Nonce never appears in iframe URL (only `cryptexMountId`). Host page can race
mount IDs (DoS) but cannot learn nonce or bind port. See
[autofill/iframe-bootstrap.md](../autofill/iframe-bootstrap.md).

## SW messaging from content script

Origin: `autofill-cs` (explicit override via `setEnvelopeOriginOverride`)

Allowed encrypted messages: see [service-worker/messaging.md](../service-worker/messaging.md).

Sensitive paths:

- `GetCredentialsForOrigin` derives the page URL from the content-script sender.
- `GetCredentialSecret` / `GenerateTOTP` repeat the shared URL policy before
  releasing secrets.
- `SaveCredentialPrompt` stashes the password in session storage for 5 minutes.
- `GetState` reveals vault locked/unlocked state to a top-frame page.

## Save-on-submit flow

```mermaid
flowchart TD
    Submit["Captured form submit"] --> Group["Find tracked group in submitted form"]
    Group --> Values["Read username and password"]
    Values --> Password{"Password present?"}
    Password -- No --> Stop["Do nothing"]
    Password -- Yes --> Unchanged{"Matches last autofill?"}
    Unchanged -- Yes --> Stop
    Unchanged -- No --> Stage["SaveCredentialPrompt"]
    Stage --> Pending["Service worker stores PENDING_SAVE<br/>with 5-minute TTL"]
    Pending --> Consent["Popup or autofill-save consent UI"]
    Consent -- New item --> Create["CreateCredential"]
    Consent -- Existing login --> Attach["AttachPasskey"]
    Consent -- Dismiss --> Consume["ConsumePendingSavePrompt"]
```

## Code review map

| Area               | Primary function/state                 | Review concern                                                         |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------- |
| Classification     | `classifyInput()`                      | Precedence of explicit metadata, exclusions, and fuzzy hints           |
| Group boundaries   | `groupContainer()` / `detectGroups()`  | Unrelated fields grouped together or valid fields separated            |
| Control policy     | `getInlineFieldMode()`                 | Picker versus generator assignment                                     |
| DOM reconciliation | `reconcile()` / `trackedFields`        | Stable field tracking, stale cleanup, and SPA field-role changes       |
| Picker binding     | `openMenuForIcon()` / `menuActiveIcon` | Panel position and behavior follow the active field                    |
| Secret fill        | `fillFromCredential()`                 | OTP targets one field; credentials fill the group                      |
| Generated fill     | `selectGeneratedPasswordFields()`      | Current passwords are never overwritten when new-password fields exist |
| Save handling      | `shouldPromptSave()`                   | Correct field selection and suppression of unchanged autofill          |
