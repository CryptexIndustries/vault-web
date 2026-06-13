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
 *   2. The content script replies with `{ kind: "init" }` carrying a
 *      `MessagePort` in the transfer list.
 *   3. From there, every interaction is sent over the port. The
 *      original `window.message` handler is removed so unsolicited
 *      page messages can't influence the iframe.
 */

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

function onBootstrapMessage(event: MessageEvent): void {
    // The CS lives in the host page's window, so `event.source` will be
    // `window.parent`. We rely on the transferred port rather than
    // sniffing `event.origin` (the parent's origin is the host page,
    // not the extension).
    if (event.source !== window.parent) return;
    const data = event.data as unknown;
    if (
        !data ||
        typeof data !== "object" ||
        (data as { kind?: unknown }).kind !== "init"
    ) {
        return;
    }
    const incoming = event.ports?.[0];
    if (!incoming) return;

    window.removeEventListener("message", onBootstrapMessage);
    port = incoming;
    port.start();
}

window.addEventListener("message", onBootstrapMessage);

if (button) {
    button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        post({ kind: "click" });
    });
    button.addEventListener("mouseenter", () => post({ kind: "hover-enter" }));
    button.addEventListener("mouseleave", () => post({ kind: "hover-leave" }));
}

// Announce ourselves to the parent. The CS will be listening for this
// before it hands us the port.
try {
    window.parent.postMessage({ kind: "ready" }, "*");
} catch (err) {
    console.debug("[autofill-icon] ready post failed", err);
}
