# Autofill Security Notes

This directory documents the security-sensitive autofill pieces in the browser
extension. For the full extension threat model and architecture, see
[../threat-model.md](../threat-model.md) and [../architecture/overview.md](../architecture/overview.md).

Keep these notes in sync with:

- `extension/src/content/autofill-cs.ts`
- `extension/src/content/origin-utils.ts`
- `extension/src/autofill-*.{ts,tsx}`
- `extension/src/background.ts`
- `extension/src/background/autofill-*.ts`
- `extension/src/types/sw-messaging.ts`
- `extension/src/utils/autofill-frame-bootstrap.ts`
- `extension/src/utils/etld.ts`
- `extension/src/utils/security-utils.ts`
- `extension/src/utils/sw-envelope-client.ts`

## Documents

- [iframe-bootstrap.md](iframe-bootstrap.md) describes how content-script mounted
  extension iframes authenticate the `MessageChannel` bootstrap with a
  service-worker-backed nonce.
- [origin-matching.md](origin-matching.md) describes exact-host credential
  matching and why eTLD+1 is not an authority for password or TOTP release.

## Invariants

- Autofill runs only in the top-level `http:` / `https:` frame.
- Extension iframes must not accept a parent `init` message unless it carries the
  nonce claimed from the service worker for the current mount id and iframe kind.
- `GetCredentialSecret` and `GenerateTOTP` release secret material only when the
  saved credential hostname exactly matches the requesting page hostname after
  normalization.
- The `fuzzy` response bucket is reserved for a future explicit opt-in
  sibling-domain feature and remains empty by default.
