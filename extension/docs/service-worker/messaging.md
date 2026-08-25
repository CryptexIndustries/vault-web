# SW Messaging and Capability Model

All privileged extension contexts communicate with the service worker through
envelopes defined in `extension/src/types/sw-messaging.ts`.

## Plaintext vs encrypted

| Path            | Allowed types              | Response                                                 |
| --------------- | -------------------------- | -------------------------------------------------------- |
| Plaintext       | `GetPublicKey` (10) only   | Plaintext envelope with SW ECDH public JWK               |
| Encrypted       | Per-origin allowlist below | Encrypted envelope, `origin: "worker"`                   |
| Security errors | Any                        | Plaintext error (`ok: false`, `code`) — not re-encrypted |

## Encryption protocol (per request)

1. Client generates ephemeral ECDH P-256 key pair.
2. Client fetches SW public key via plaintext `GetPublicKey`.
3. HKDF info string: `"cryptex-extension-session"`.
4. AES-GCM encrypts `JSON.stringify(payload)`.
5. `requestId` is a ULID; client caches derived session key by `requestId`.
6. SW decrypts with active IndexedDB `keyPairs` row (`status === "active"`).
7. SW re-encrypts response with same `requestId`, reusing request
   `ephemeralPub` / `salt` / `wrappedKey`.
8. Client decrypts and deletes session key cache entry.

Key rotation: decommissioned `keyId` returns `STALE_KEY` + `latestKeyId`;
client retries with refreshed public key.

## Envelope security gates (`security-utils.ts`)

Applied before decryption:

| Gate      | Rule                                                                     |
| --------- | ------------------------------------------------------------------------ |
| Timestamp | ISO `envelope.timestamp` within ±2 minutes                               |
| Replay    | Duplicate `origin:requestId` → `REPLAY_DETECTED` (10 min TTL, in-memory) |
| Origin    | Sender URL must match claimed `EnvelopeOrigin`                           |

### Origin validation rules

| Claimed origin       | Validation                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `popup`              | `sender.url` starts with `chrome.runtime.getURL("/popup.html")`            |
| `link`               | `sender.url` starts with `chrome.runtime.getURL("/link.html")`             |
| `worker`             | `sender.id === chrome.runtime.id` only (response tag; weak client binding) |
| `autofill-menu`      | URL prefix `/autofill-menu.html`                                           |
| `autofill-generator` | URL prefix `/autofill-generator.html`                                      |
| `autofill-save`      | URL prefix `/autofill-save.html`                                           |
| `autofill-cs`        | Extension id + `sender.tab` + **`sender.frameId === 0`**                   |

Content script sets origin explicitly via `setEnvelopeOriginOverride("autofill-cs")`
because isolated-world URLs are not extension pages.

## Capability allowlists

Encrypted messages are rejected with `MESSAGE_TYPE_NOT_ALLOWED` when
`envelope.origin` + `envelope.type` is not in the table below. Checked after
`validateEnvelope` and before `decryptEnvelope`.

### `popup`

`GetState`, `Unlock`, `Lock`, `GetCredentials`, `GetCredential`,
`CreateCredential`, `UpdateCredential`, `DeleteCredential`, `GetLinkedDevices`,
`SyncGetItemCredentials`, `SyncGetItemVersionVectors`, `SyncGetConfiguration`,
`SyncUpdateCredentials`, `ProxyFetch`, `GetPendingSavePrompt`,
`ConsumePendingSavePrompt`, `GetActivePageOrigin`, `AttachPasskey`,
`GetPendingPasskeyAssertion`, `CompletePasskeyAssertion`,
`DeclinePasskeyAssertion`

### `link`

`ProxyFetch`, `OnlineServicesEstablish`, `OnlineServicesClear`

### `worker`

None (empty allowlist)

### `autofill-cs` (top frame only)

`GetState`, `GetCredentialsForOrigin`, `GetCredentialSecret`, `GenerateTOTP`,
`SaveCredentialPrompt`, `GetPendingSavePrompt`, `OpenPopup`,
`RegisterAutofillFrame`, `ReportPageOrigin`, `BeginPasskeyAssertion`,
`ConsumePasskeyAssertionResult`, `CancelPasskeyAssertion`

### `autofill-menu`

`ClaimAutofillFrame`

### `autofill-generator`

`ClaimAutofillFrame`

### `autofill-save`

`GetCredentials`, `CreateCredential`, `AttachPasskey`,
`ConsumePendingSavePrompt`, `ClaimAutofillFrame`

## Handler dispatch highlights

After decryption, `processMessage` routes by `MessageType`. Candidate discovery
and secret release derive the full page URL from the content-script sender and
apply the shared credential URL matcher. See
[autofill/origin-matching.md](../autofill/origin-matching.md).

For popup site context, `ReportPageOrigin` and `OpenPopup` record the
top-frame content script's sender-derived origin by tab id. `GetActivePageOrigin`
looks up that context using the active tab id without requiring access to
`Tab.url`, then confirms it against the currently running top-frame content
script. Navigation-start and tab-removal events invalidate the stored value.

### ProxyFetch (`request-auth-interceptor.ts`)

- URL must be tRPC on `NEXT_PUBLIC_APP_URL` (`isTrpcApiRequest`)
- Methods: `GET`, `POST` only
- Caller `Authorization` header always stripped
- SW injects JWT only when `trpcBatchRequiresAuth(url)` (procedures not under `v1.auth.*`)
- `credentials: "omit"` — no API cookies

## Client call sites

| Client                               | Origin tag    | Transport                                          |
| ------------------------------------ | ------------- | -------------------------------------------------- |
| `popup.tsx`, `vault-view.tsx`        | `popup`       | Direct envelope + some `sendEncryptedEnvelopeToSW` |
| `link.tsx`, `popup-receive-link.tsx` | `link`        | `sw-proxy-fetch`, `online-services-session-client` |
| `autofill-cs.ts`                     | `autofill-cs` | `sw-envelope-client`                               |
| Autofill iframes                     | per-kind      | `sw-envelope-client` + frame bootstrap             |

## Known limitations

- **Response envelope validation** — `TODOvalidateResponseEnvelope` is a stub;
  clients trust SW responses after ECDH decrypt over the extension message channel.
- **Replay cache** — In-memory only; resets on MV3 service worker eviction.
- **`worker` origin** — Only checks extension id; low impact (public key is public).
