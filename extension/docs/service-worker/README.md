# Service Worker

The MV3 service worker (`extension/src/background.ts`) is the sole owner of
decrypted vault material, session DEK bytes, and Online Services credentials
while the vault is unlocked.

## Documents

- [messaging.md](messaging.md) — Envelope protocol, origin validation, capability
  allowlists, handler dispatch
- [session-and-keys.md](session-and-keys.md) — Unlock/lock lifecycle, session
  storage keys, ECDH rotation, idle timeout

## Responsibilities

| Area             | Files                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| Envelope hub     | `background.ts`, `utils/security-utils.ts`, `utils/session-utils.ts`      |
| Vault session    | `background.ts`, `background/session-dek-store.ts`                        |
| Backups          | `background/backup-service.ts`, `utils/backup-staging.ts`                 |
| Autofill routing | `background/autofill-router.ts`, `background/autofill-frame-bootstrap.ts` |
| tRPC proxy       | `background/request-auth-interceptor.ts`                                  |
| OS JWT           | `app_lib/auth-session-ext.ts`, `utils/online-services-session-storage.ts` |
| Wire types       | `types/sw-messaging.ts`                                                   |
| Client transport | `utils/sw-envelope-client.ts`                                             |

## Entry pipeline

Every `chrome.runtime.onMessage` payload must be envelope-shaped. Legacy plaintext
messages return `LEGACY_MESSAGE_FORMAT_NOT_SUPPORTED`.

```
onMessage
  → validateEnvelope (timestamp, replay, origin)
  → plaintext branch: GetPublicKey only
  → encrypted branch:
      → capability gate (origin + MessageType)
      → decryptEnvelope
      → processMessage
      → createEncryptedResponseEnvelope
```

`RegisterAutofillFrame` and `ClaimAutofillFrame` skip
`ensureOffscreenDocument()` for lower latency.

## Session storage keys (while unlocked)

| Key               | Content                                    |
| ----------------- | ------------------------------------------ |
| `UV`              | Full decrypted `Vault` protobuf            |
| `UVM`             | Base64-encoded vault metadata              |
| `AVI`             | Active vault DB index                      |
| `SESSION_DEK:{n}` | Raw vault DEK (base64)                     |
| `OS_SESSION`      | JWT, expiry, deviceId, privateKeyJWK       |
| `PENDING_SAVE`    | Captured login for save prompt (5 min TTL) |

All cleared on `Lock`, 30-minute system idle, or `chrome.storage.session.clear()`.
