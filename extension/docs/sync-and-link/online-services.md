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

Establish flow uses shared `online-services-session/protocol.ts` (challenge →
sign → verify) with platform-specific storage:

- **Web:** `auth-session.ts` → Jotai `onlineServicesDataAtom`
- **Extension SW:** `auth-session-ext.ts` → `OS_SESSION`

Auth bootstrap procedures (`v1.auth.*`) use direct tRPC/fetch in each platform
layer (web relative `/api/trpc`; SW `globalThis.fetch`) to avoid proxy recursion.

## Refresh and re-auth

- Refresh: `v1.auth.refresh` with 60 s lead time before expiry.
- Re-auth fallbacks: stored `deviceId`/`privateKeyJWK`, then unlocked vault
  `UV.OnlineServices`.
- Shared helpers: `createRefreshInFlightRunner`, `createForcedReauthGate`.

## Session port (shared sync/link code)

Shared `web/src/app_lib/synchronization.ts` imports
`onlineServicesSessionPort` for refresh/re-auth retries before protected API
calls (TURN credentials, Pusher channel auth). It does **not** read JWTs
directly.

| Runtime   | Binding                                                           |
| --------- | ----------------------------------------------------------------- |
| Web       | `online-services-session/web.ts` → Jotai `auth-session.ts`        |
| Extension | `online-services-session/extension.ts` → SW envelopes (see below) |

Extension UI messages for the port adapter:

| Message                             | Purpose                        |
| ----------------------------------- | ------------------------------ |
| `OnlineServicesEnsureFresh`         | Refresh / establish in SW      |
| `OnlineServicesForceReauthenticate` | Full passkey re-auth after 401 |

Allowed from **popup** and **link** origins.

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

| Origin     | OS messages                                                                           |
| ---------- | ------------------------------------------------------------------------------------- |
| `popup`    | Unlock bootstrap + `ProxyFetch` + `OnlineServicesEnsureFresh` / `ForceReauthenticate` |
| `link`     | `OnlineServicesEstablish`, `OnlineServicesClear`, `ProxyFetch`, port messages         |
| All others | No direct OS establish                                                                |

## Extension vs web auth-session split

The web app keeps JWT awareness in Jotai (`auth-session.ts`). The extension
stores JWTs in the SW (`auth-session-ext.ts` + `OS_SESSION`) and injects them in
`ProxyFetch`. Shared sync/link code uses `onlineServicesSessionPort` plus tRPC
transport auth — not Jotai atoms or `createBareAuthHeader()`.

## File map

| Path                                                  | Role                             |
| ----------------------------------------------------- | -------------------------------- |
| `web/src/app_lib/online-services-session/port.ts`     | Session port interface           |
| `web/src/app_lib/online-services-session/protocol.ts` | Shared challenge/refresh helpers |
| `web/src/app_lib/online-services-session/web.ts`      | Web port adapter                 |
| `src/app_lib/online-services-session/extension.ts`    | Extension port adapter           |
| `src/app_lib/auth-session-ext.ts`                     | SW JWT lifecycle                 |
| `src/utils/online-services-session-storage.ts`        | `OS_SESSION` read/write/clear    |
| `src/utils/online-services-session-client.ts`         | UI → SW session envelopes        |
| `src/background/request-auth-interceptor.ts`          | ProxyFetch + auth injection      |
| `src/utils/trpc-auth-url.ts`                          | tRPC URL parsing                 |
| `src/trpc-ext.ts`                                     | Extension tRPC client            |
