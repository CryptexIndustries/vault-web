# Autofill Origin Matching

Autofill credential matching is exact-host-only by default. Credential discovery
for the menu and secret release for fill/TOTP actions use the same hostname
comparison, but the service worker treats secret release as the enforcement
boundary.

## Policy

The extension may show a credential in the menu only when:

- Autofill is running on a top-level `http:` / `https:` page.
- The `autofill-menu` iframe requests discovery with the host received from the
  content script's `getEffectiveOrigin()` init payload.
- The page hostname and saved credential hostname match exactly after
  normalization.
- The saved credential URL is parseable.
- The credential is not deleted.

The service worker releases password or TOTP material only when:

- The request comes from `autofill-cs`.
- The service worker derives a parseable `http:` / `https:` page URL from
  `chrome.runtime.MessageSender`.
- The sender-derived page hostname exactly matches the saved credential hostname
  after normalization.

Normalization lowercases hosts and removes a trailing dot. Saved URLs are
trimmed, scheme-less values are parsed as `https://...`, and matching uses
hostname only. Scheme, port, path, and query do not participate in matching. The
policy does not collapse sibling subdomains.

Allowed:

- Page `login.example.com` and saved URL `https://login.example.com`.
- Page `login.example.com.` and saved URL `https://Login.Example.Com.`.

Denied:

- Page `evil.example.com` and saved URL `https://login.example.com`.
- Page `example.com` and saved URL `https://login.example.com`.
- Saved credentials with no parseable URL.

## Discovery vs Release Authority

`GetCredentialsForOrigin` matches on `payload.host` supplied by the
`autofill-menu` iframe. That host originates in the content script's
`getEffectiveOrigin()` result and is passed to the menu over the authenticated
iframe bootstrap channel. The service worker does not re-derive the tab URL for
credential discovery.

`GetCredentialSecret` and `GenerateTOTP` re-check origin from
`chrome.runtime.MessageSender` via `getAutofillRequestOrigin()` in
`background.ts`. A stale or incorrect menu list can therefore show metadata for a
credential that will not be releasable at fill time.

## Why eTLD+1 Is Not Used For Release

`etldPlus1()` still exists for origin context and future UX. It uses a small
hand-maintained suffix table, not a full Public Suffix List. That means it is not
appropriate as an authority for releasing secrets.

Even with a perfect Public Suffix List, same registrable domain does not imply
same security boundary. A credential for `login.example.com` must not be offered
to `evil.example.com` unless a future feature records explicit user approval for
that sibling-domain relationship.

## Response Shape

`GetCredentialsForOriginResponse` still returns:

- `exact`: exact-host matches.
- `fuzzy`: reserved for a future explicit opt-in sibling-domain feature.

`fuzzy` is empty by default. Do not populate it from eTLD+1 matching without a
new persisted user-consent model and matching service-worker enforcement for
`GetCredentialSecret` and `GenerateTOTP`.

`etldPlus1` is still present in `GetCredentialsForOriginRequest` for context and
future compatibility, but the current matcher ignores it.

## Secret Release

The menu can only request a fill by credential id. The service worker re-checks
the requesting page origin from `chrome.runtime.MessageSender` before releasing
secret material.

Secret-bearing handlers:

- `GetCredentialSecret`
- `GenerateTOTP`

Both handlers return `ORIGIN_MISMATCH` for sibling subdomains and
`CREDENTIAL_ORIGIN_UNVERIFIED` for URL-less or unparseable credentials.
Routing in `background.ts` returns `REQUEST_ORIGIN_UNAVAILABLE` if the
content-script sender has no parseable `http:` / `https:` URL.

If the page navigates while a menu is open, the list may be stale. The secret
release check still uses the current sender-derived page URL and denies mismatch.

## Code Map

- `extension/src/content/origin-utils.ts` derives page origin context in the
  content script.
- `extension/src/background.ts` derives requester origin from
  `chrome.runtime.MessageSender` for secret release.
- `extension/src/background/autofill-router.ts` performs matching and secret
  release checks.
- `extension/src/utils/etld.ts` provides eTLD+1 context but is not a secret
  release authority.
- `extension/src/autofill-menu.tsx` renders only returned matches.

## Regression Coverage

Tests live in `extension/tests/autofill-router.test.ts` and cover:

- Exact-host discovery only.
- Case/trailing-dot normalization.
- Denial of password release to sibling subdomains.
- Denial of TOTP generation to sibling subdomains.

The tests cover `matchCredentialsForOrigin` and sibling-domain denial for
secret-bearing handlers. They do not yet cover `handleGetCredentialsForOrigin`
integration, unparseable-credential release denial, or
`REQUEST_ORIGIN_UNAVAILABLE` routing.
