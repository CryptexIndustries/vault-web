# Online Services

Online Services provides Cryptex-hosted signaling, TURN, and API authentication
via a passkey-backed JWT. In the extension, the service worker owns the session;
UI pages establish or clear it through encrypted envelopes.

## Session storage

Key: `OS_SESSION` in `chrome.storage.session`

| Field              | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `sessionToken`     | Bearer JWT for tRPC                           |
| `sessionExpiresAt` | Expiry timestamp                              |
| `deviceId`         | Device identifier                             |
| `privateKeyJWK`    | Passkey private key for re-auth without popup |

Cleared on lock, 30-minute system idle, link flow without OS package, or
`OnlineServicesClear`.

## Establishment paths

| Path             | Trigger                          | SW message                               |
| ---------------- | -------------------------------- | ---------------------------------------- |
| Unlock bootstrap | Vault has `OnlineServices` creds | Internal after `Unlock`                  |
| Link receive     | Package includes OS creds        | `OnlineServicesEstablish` from link page |

Establish flow (`auth-session-ext.ts`):

1. `v1.auth.challenge` with `deviceId`
2. Sign challenge with device passkey private key
3. `v1.auth.verify` → store JWT + creds in `OS_SESSION`

Auth bootstrap procedures (`v1.auth.*`) use `globalThis.fetch` directly in SW
to avoid proxy recursion.

## Refresh and re-auth

- Refresh: `v1.auth.refresh` with 60 s lead time before expiry.
- Re-auth fallbacks: stored `deviceId`/`privateKeyJWK`, then unlocked vault
  `UV.OnlineServices`.

## tRPC proxy chain

```
UI (popup | link)
  trpc-ext.ts
    sw-proxy-fetch.ts
      sw-envelope-client.ts
        background.ts ProxyFetch
          request-auth-interceptor.ts
            ensureFreshOnlineServicesSession()
            fetch with injected Authorization
```

Rules (`trpc-auth-url.ts`):

- Only `NEXT_PUBLIC_APP_URL` + `/api/trpc/` URLs accepted
- `v1.auth.*` procedures never receive injected `Authorization`
- Caller `Authorization` always stripped
- `credentials: "omit"`

## Per-origin access

| Origin     | OS messages                                                    |
| ---------- | -------------------------------------------------------------- |
| `popup`    | Via unlock bootstrap + ProxyFetch (indirect)                   |
| `link`     | `OnlineServicesEstablish`, `OnlineServicesClear`, `ProxyFetch` |
| All others | No direct OS establish                                         |

## Extension vs web auth-session split

The web app uses Jotai atoms (`auth-session.ts`) for UI-side JWT awareness.
The extension routes tRPC through SW but does not alias `auth-session.ts`.
After `establishOnlineServicesSessionViaSW`, SW holds the JWT while UI atoms
may be empty. Shared sync code paths that gate on `createBareAuthHeader()` can
fail for Online Services TURN bootstrap even when SW has a valid session. See
threat model residual risks.

## File map

| Path                                           | Role                          |
| ---------------------------------------------- | ----------------------------- |
| `src/app_lib/auth-session-ext.ts`              | SW JWT lifecycle              |
| `src/utils/online-services-session-storage.ts` | `OS_SESSION` read/write/clear |
| `src/utils/online-services-session-client.ts`  | UI wrappers                   |
| `src/background/request-auth-interceptor.ts`   | ProxyFetch + auth injection   |
| `src/utils/trpc-auth-url.ts`                   | tRPC URL parsing              |
| `src/trpc-ext.ts`                              | Extension tRPC client         |
