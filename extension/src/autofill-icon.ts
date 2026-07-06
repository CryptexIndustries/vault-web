/**
 * Per-field autofill icon iframe.
 *
 * The iframe is rendered by the content script anchored over an input
 * field. It deliberately holds *no* state about the page or the vault;
 * its only job is to display a clickable shield and dispatch click
 * events back to the content script over a `MessageChannel`. That
 * keeps the bundle tiny (loaded once per field) and means a malicious
 * page can't extract anything sensitive even if it manages to read the
 * iframe contents (which it can't anyway because we render from the
 * extension origin).
 *
 * Handshake:
 *   1. On load the iframe posts `{ kind: "ready" }` to its parent
 *      window so the content script knows where to send the port.
 *   2. The content script replies with `{ kind: "init", nonce }`
 *      carrying a `MessagePort` in the transfer list. The nonce is
 *      claimed from the SW so the host page cannot spoof the bootstrap.
 *   3. From there, every interaction is sent over the port. The
 *      original `window.message` handler is removed so unsolicited
 *      page messages can't influence the iframe.
 */

import {
    claimAutofillFrameBootstrap,
    isExpectedAutofillInit,
} from "./utils/autofill-frame-bootstrap";

type IconMessage =
    | { kind: "click" }
    | { kind: "hover-enter" }
    | { kind: "hover-leave" };

const button = document.getElementById(
    "autofill-icon",
) as HTMLButtonElement | null;
const shieldIcon = document.getElementById("autofill-icon-shield");
const keyIcon = document.getElementById("autofill-icon-key");
const iconMode =
    new URLSearchParams(window.location.search).get("mode") === "generator"
        ? "generator"
        : "autofill";

if (iconMode === "generator") {
    button?.setAttribute("aria-label", "Generate password");
    button?.classList.add("autofill-icon--generator");
    shieldIcon?.setAttribute("hidden", "");
    keyIcon?.removeAttribute("hidden");
}

let port: MessagePort | null = null;

function post(message: IconMessage): void {
    if (!port) return;
    try {
        port.postMessage(message);
    } catch (err) {
        console.debug("[autofill-icon] post failed", err);
    }
}

async function initialiseBootstrap(): Promise<void> {
    const bootstrap = await claimAutofillFrameBootstrap("autofill-icon");
    if (!bootstrap) return;

    const onBootstrapMessage = (event: MessageEvent) => {
        // The CS lives in the host page's window, so `event.source` will be
        // `window.parent`. The parent origin is the host page, so the
        // SW-backed nonce authenticates the content script instead.
        if (event.source !== window.parent) return;
        if (!isExpectedAutofillInit(event.data, bootstrap)) return;
        const incoming = event.ports?.[0];
        if (!incoming) return;

        window.removeEventListener("message", onBootstrapMessage);
        port = incoming;
        port.start();
    };

    window.addEventListener("message", onBootstrapMessage);

    // Announce ourselves to the parent. The CS will be listening for this
    // before it hands us the port.
    try {
        window.parent.postMessage(
            { kind: "ready", mountId: bootstrap.mountId },
            "*",
        );
    } catch (err) {
        console.debug("[autofill-icon] ready post failed", err);
    }
}

if (button) {
    button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        post({ kind: "click" });
    });
    button.addEventListener("mouseenter", () => post({ kind: "hover-enter" }));
    button.addEventListener("mouseleave", () => post({ kind: "hover-leave" }));
}

void initialiseBootstrap();
