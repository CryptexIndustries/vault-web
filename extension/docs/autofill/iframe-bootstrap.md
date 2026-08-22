# Autofill Iframe Bootstrap

The autofill content script mounts extension-origin iframes into third-party
pages for the credential menu, password generator, and save prompt. Those
iframes are isolated from the page by origin, but from inside the iframe both
the page script and isolated-world content script appear as `window.parent`.
The iframe therefore cannot trust `event.source` alone.

## Threat Model

A hostile page can:

- Read iframe attributes, including `src` query parameters.
- Send `postMessage` events to the iframe as `window.parent`.
- Race the legitimate content script during the iframe bootstrap.
- Embed web-accessible extension autofill iframe URLs and trigger a
  `ClaimAutofillFrame` from that iframe context. This can consume a known
  `mountId` and cause denial of service for that mount.

A hostile page cannot:

- Invoke `RegisterAutofillFrame` or read encrypted service-worker replies.
- Read the iframe DOM or JavaScript state across the extension origin boundary.

## Bootstrap Flow

1. The content script calls `createAutofillFrameBootstrap(kind)` before setting
   the iframe `src`.
2. `createAutofillFrameBootstrap` generates a random `mountId` and secret
   `nonce`, then sends encrypted `RegisterAutofillFrame` as `autofill-cs`.
3. The service worker stores `{ nonce, kind, tabId, frameId, createdAt }`,
   keyed by `mountId`, in its in-memory registry.
4. The content script loads the iframe with only `cryptexMountId=<mountId>` in
   the URL. The nonce is not placed in the DOM.
5. The extension iframe calls `claimAutofillFrameBootstrap(kind)`, sending
   encrypted `ClaimAutofillFrame` as its own extension origin.
6. The service worker checks mount id, iframe kind, and tab id, then returns the
   nonce and deletes the registry entry.
7. The iframe posts `{ kind: "ready", mountId }` to its parent.
8. The content script replies to `EXTENSION_ORIGIN` with
   `{ kind: "init", mountId, nonce }` and transfers the `MessagePort`.
9. The iframe accepts the port only when `mountId` and `nonce` match the claimed
   bootstrap values.

## Service Worker Registry

Registry implementation: `extension/src/background/autofill-frame-bootstrap.ts`.

Important properties:

- Entries expire after two minutes.
- Tokens are random URL-safe values (base64-derived, with `-` / `_`
  substitutions).
- Claims are one-time use.
- Claims must come from the same tab as the registering content script.
- Claims must use the same iframe kind registered by the content script.
- `frameId` is recorded at register time but not checked on claim. Registration
  comes from the top-frame content script; claims come from extension iframes in
  subframes and are bound by tab id plus iframe kind.

`RegisterAutofillFrame` and `ClaimAutofillFrame` are handled before the main
vault message switch in `background.ts` because iframe bootstrap does not need
vault unlock state.

Client helpers live in `extension/src/utils/autofill-frame-bootstrap.ts`.

## Envelope Gates

The encrypted envelope allowlist in `background.ts` and sender validation in
`security-utils.ts` gate bootstrap messages before registry logic:

- `RegisterAutofillFrame` is allowed only from `autofill-cs`, which must be the
  top-frame content script.
- `ClaimAutofillFrame` is allowed only from the `autofill-menu`,
  `autofill-generator`, and `autofill-save` extension iframe origins.
- Other origins cannot invoke these message types even if they reach the service
  worker.

The field control is a closed shadow root owned by the content script. It does
not exchange messages with the service worker and needs no iframe bootstrap.

## Caller Responsibilities

Content script:

- Register bootstrap before loading the iframe.
- Include only `mountId` in the iframe URL.
- Treat `ready` as authentic only when `event.source` is the mounted iframe's
  `contentWindow` and `event.origin` is the extension origin. The `mountId` in
  the `ready` payload is informational.
- Send `init` to the extension origin only after authenticating `ready`.
- Remove handshake listeners when panels close or stale async mounts are
  cancelled.

Iframe pages:

- Claim bootstrap before posting `ready`.
- Reject all parent `init` messages that do not match the claimed `mountId` and
  `nonce`.
- Remove the window message listener after accepting the transferred port.

## Failure Behavior

Bootstrap failures fail closed. The iframe does not post `ready` if it cannot
claim a nonce. The content script does not create a port if registration fails.
Expired or already-claimed mounts fail claim; the iframe never posts `ready`,
and the content script never transfers a port.

A page that learns a `mountId` can attempt to race a duplicate extension iframe
and consume the one-time claim, causing denial of service for that mount. It
still cannot learn the nonce or bind its own `MessagePort` to the legitimate
iframe.

## Regression Coverage

Tests live in `extension/tests/autofill-frame-bootstrap.test.ts` and cover:

- One-time claim of a registered nonce.
- Rejection of claims from another tab.
- Rejection of claims for the wrong iframe kind.

These tests cover service-worker registry behavior only. They do not yet cover
full content-script-to-iframe handshake integration.
