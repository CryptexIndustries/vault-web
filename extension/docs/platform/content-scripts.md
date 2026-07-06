# Content Scripts

The extension injects one content script bundle on all `http:` and `https:` pages.

## Manifest injection

```
js: assets/autofill-cs.js (IIFE, vite.config.content.ts)
matches: http://*/*, https://*/*
run_at: document_idle
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

## Field detection (`field-detector.ts`)

- Walks DOM including open shadow roots
- Classifies inputs (username, password, email, OTP, etc.)
- Groups into login / signup / OTP clusters
- **Never reads input values** during detection — values read only at fill/save time

## Injection model

The content script does not inject scripts into the page. It injects
**extension-origin iframes** into host DOM:

| Iframe                    | Purpose                    |
| ------------------------- | -------------------------- |
| `autofill-icon.html`      | Per-field autofill trigger |
| `autofill-menu.html`      | Credential picker          |
| `autofill-generator.html` | Password generator         |
| `autofill-save.html`      | Save-login consent panel   |

URLs from `chrome.runtime.getURL()` → web-accessible resources.

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

- `GetCredentialSecret` / `GenerateTOTP` — exact-host match on `sender.tab.url`
- `SaveCredentialPrompt` — stashes password in session (5 min TTL)
- `GetState` — reveals vault locked/unlocked to any top-frame page

## Save-on-submit flow

1. CS detects form submit with captured username/password.
2. `SaveCredentialPrompt` stashes in `PENDING_SAVE`.
3. Badge on extension icon; popup or `autofill-save` iframe shows consent UI.
4. User confirms → `CreateCredential`; dismiss → `ConsumePendingSavePrompt`.

## No dynamic scripting

`chrome.scripting` permission is declared but unused. No `executeScript` into
host page context.
