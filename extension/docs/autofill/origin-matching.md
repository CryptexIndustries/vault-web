# Autofill origin matching

Each saved website has its own matching rule. The same rule engine controls the
picker, password release, TOTP release, popup site filtering, and quick-copy
checks.

## Rule modes

### Exact host

This is the default and safest mode. The saved and current hostnames must match.
Paths, queries, and fragments do not participate.

`https://www.example.com/account` matches other pages on
`www.example.com`, but not `app.example.com`.

### Parent and sibling domains

This mode compares registrable domains using the Public Suffix List. A rule for
`www.example.com` can match `example.com`, `app.example.com`, and deeper hosts
under `example.com`.

Private suffixes remain tenant boundaries. A rule for `alice.github.io` does not
match `bob.github.io`.

This mode is deliberately broad. Use it only when every matching host belongs to
the same account boundary.

### Wildcard

Wildcard rules accept `*` as a complete hostname label:

- `https://*.example.com` matches `app.example.com`.
- It does not match the apex `example.com`.
- `*` cannot replace any label in the registrable domain. Patterns such as
  `https://*.com` are rejected.

Paths may also contain wildcards. `*` stays within one path segment and `**`
crosses segments:

- `https://*.example.com/login/*`
- `https://*.example.com/accounts/**`

The matcher validates the hostname separately before evaluating the path. Text
inside a foreign URL path cannot satisfy the hostname pattern.

## Shared protocol and port rules

All modes enforce these checks:

- Values without a scheme are treated as HTTPS.
- An HTTP rule may upgrade to an HTTPS page.
- An HTTPS rule cannot match an HTTP page.
- Explicit non-default ports must match.

## Multiple URLs

`Credential.URL` and `Credential.URLMatchMode` define the primary website rule.
`Credential.AdditionalURLs` stores extra `{ URL, MatchMode }` rules.

Exact matches rank above wildcard matches, which rank above domain matches. This
chooses the most specific saved URL for display while authorizing the credential
only once.

Empty, invalid, unsafe, and duplicate additional rules are removed when a
credential is created or updated. Existing credentials migrate to exact-host
mode. Native JSON imports also convert the earlier string-only additional URL
format to exact-host rules.

Bitwarden imports preserve domain and host modes where they map cleanly.
Unsupported imported match modes fall back to exact host.

## Request authority

The credential menu does not send a hostname to the service worker. It asks the
parent content script for candidates over the authenticated `MessageChannel`.
The content script then sends `GetCredentialsForOrigin`.

The service worker derives the full page URL from
`chrome.runtime.MessageSender`. It does not trust a URL supplied by the menu or
host page.

## Secret release

Candidate discovery returns credential metadata only. `GetCredentialSecret` and
`GenerateTOTP` derive the sender URL again and run the same matcher before
returning secret material.

If navigation occurs while a picker is open, a stale selection is denied
because the release check uses the current sender URL.

Handlers return:

- `ORIGIN_MISMATCH` when the credential has verified rules but none authorize
  the current page.
- `CREDENTIAL_ORIGIN_UNVERIFIED` when the credential has no valid rule.
- `REQUEST_ORIGIN_UNAVAILABLE` when the worker cannot derive an HTTP or HTTPS
  sender URL.

## Response shape

`GetCredentialsForOriginResponse.matches` contains the authorized credentials.
The matched rule URL travels with each lightweight result so the popup can apply
the same policy to quick actions.

## Code map

- `packages/vault-core/src/credential-url.ts` owns URL normalization and
  matching.
- `web/src/components/vault-dashboard/credential-url-rules.tsx` owns the shared
  rules editor.
- `extension/src/background.ts` derives the requester URL.
- `extension/src/background/autofill-router.ts` applies matching to discovery
  and secret release.
- `extension/src/content/autofill-cs.ts` relays candidate requests from the menu.
- `extension/src/vault-view.tsx` applies the same policy to current-site actions.

## Regression coverage

Tests cover exact, domain, wildcard, and multi-URL rules; private suffix
boundaries; wildcard host isolation; matching priority; HTTPS downgrade denial;
port checks; legacy migration; password release; and TOTP release.
