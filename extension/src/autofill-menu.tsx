/**
 * Inline autofill menu iframe.
 *
 * Rendered by the content script next to the focused field. Owns two
 * UI states:
 *   - Locked: shows a single "Unlock vault" button. Clicking it asks
 *     the parent CS to open the action popup. We deliberately do *not*
 *     accept the vault passphrase in the iframe — the iframe lives on
 *     a third-party page and we don't want users habituated to typing
 *     their vault secret somewhere a phishing page could imitate.
 *   - Unlocked: shows credentials authorized for the active page. When the
 *     focused field is an OTP slot, only credentials with TOTP configured are
 *     listed and selecting one fills the rolling code instead.
 *
 * Communication with the parent CS is bidirectional over a
 * `MessageChannel` port that the parent transfers in during the
 * initial handshake. The parent content script performs credential discovery so
 * the service worker can derive the page URL from the browser-authenticated
 * sender.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Key, Loader2, Lock, ShieldCheck } from "lucide-react";

import "./autofill-menu.css";

import {
    type GetCredentialsForOriginResponse,
    type LiteCredential,
} from "./types/sw-messaging";
import { uiLog } from "./utils/ext-logging";
import {
    claimAutofillFrameBootstrap,
    isExpectedAutofillInit,
} from "./utils/autofill-frame-bootstrap";

type FieldKind = "username" | "password" | "newPassword" | "otp";

type InitPayload = {
    host: string;
    fieldKind: FieldKind;
    locked: boolean;
};

type ParentMessage =
    | { kind: "credentials-request"; otpOnly: boolean }
    | { kind: "unlock-request" }
    | { kind: "pick"; credentialId: string; useTotpOnly: boolean }
    | { kind: "close" };

type IncomingMessage =
    | { kind: "init"; payload: InitPayload }
    | { kind: "credentials"; payload: GetCredentialsForOriginResponse }
    | { kind: "state-changed"; locked: boolean };

let outboundPort: MessagePort | null = null;

function postToParent(message: ParentMessage): void {
    if (!outboundPort) return;
    try {
        outboundPort.postMessage(message);
    } catch (err) {
        uiLog.warn("[autofill-menu] post failed", { err });
    }
}

const App = () => {
    const [init, setInit] = useState<InitPayload | null>(null);
    const [locked, setLocked] = useState<boolean>(true);
    const [loading, setLoading] = useState<boolean>(false);
    const [matches, setMatches] = useState<LiteCredential[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const onPortMessage = (event: MessageEvent) => {
            const data = event.data as IncomingMessage | undefined;
            if (!data || typeof data !== "object") return;
            if (data.kind === "init") {
                setInit(data.payload);
                setLocked(data.payload.locked);
            } else if (data.kind === "credentials") {
                setLoading(false);
                if (!data.payload.ok) {
                    setLoadError(data.payload.error ?? "UNKNOWN");
                    setMatches([]);
                } else {
                    setMatches(data.payload.matches);
                }
            } else if (data.kind === "state-changed") {
                setLocked(data.locked);
            }
        };

        let onBootstrap: ((event: MessageEvent) => void) | null = null;
        void claimAutofillFrameBootstrap("autofill-menu").then((bootstrap) => {
            if (cancelled || !bootstrap) return;
            onBootstrap = (event: MessageEvent) => {
                if (event.source !== window.parent) return;
                if (!isExpectedAutofillInit(event.data, bootstrap)) return;
                const port = event.ports?.[0];
                if (!port) return;
                const currentBootstrap = onBootstrap;
                if (currentBootstrap) {
                    window.removeEventListener("message", currentBootstrap);
                }
                onBootstrap = null;
                outboundPort = port;
                port.onmessage = onPortMessage;
                port.start();
            };

            window.addEventListener("message", onBootstrap);

            try {
                window.parent.postMessage(
                    { kind: "ready", mountId: bootstrap.mountId },
                    "*",
                );
            } catch (err) {
                uiLog.warn("[autofill-menu] ready post failed", { err });
            }
        });

        return () => {
            cancelled = true;
            if (onBootstrap) {
                window.removeEventListener("message", onBootstrap);
            }
            if (outboundPort) {
                outboundPort.onmessage = null;
                outboundPort.close();
                outboundPort = null;
            }
        };
    }, []);

    const otpOnly = init?.fieldKind === "otp";

    const loadCredentials = useCallback(() => {
        if (!init) return;
        setLoading(true);
        setLoadError(null);
        postToParent({ kind: "credentials-request", otpOnly });
    }, [init, otpOnly]);

    useEffect(() => {
        if (!init) return;
        if (locked) return;
        void loadCredentials();
    }, [init, locked, loadCredentials]);

    const headingHost = useMemo(() => init?.host ?? "this site", [init]);

    if (!init) {
        return (
            <div className="dark flex h-full items-center justify-center bg-popover/95 text-popover-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (locked) {
        return (
            <div className="dark flex h-full flex-col rounded-md border bg-popover/95 p-3 text-popover-foreground shadow-xl">
                <div className="flex items-start gap-2">
                    <span className="rounded-md bg-primary/15 p-1.5 text-primary">
                        <Lock className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="text-xs font-semibold">
                            Unlock Cryptex Vault
                        </h1>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                            Unlock to autofill on <strong>{headingHost}</strong>
                            . For your safety, the password is only ever entered
                            in the extension popup.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => postToParent({ kind: "unlock-request" })}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Open vault
                </button>
            </div>
        );
    }

    const showEmpty = !loading && !loadError && !matches.length;

    return (
        <div className="dark flex h-full max-h-[320px] flex-col overflow-hidden rounded-md border bg-popover/95 text-popover-foreground shadow-xl">
            <header className="flex items-center gap-2 border-b px-3 py-2">
                <span className="rounded-md bg-primary/15 p-1 text-primary">
                    <ShieldCheck className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-xs font-semibold">
                        {otpOnly ? "Fill one-time code" : "Cryptex Vault"}
                    </h1>
                    <p className="truncate text-[10px] text-muted-foreground">
                        {headingHost}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => postToParent({ kind: "close" })}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    aria-label="Close menu"
                >
                    Close
                </button>
            </header>

            <div className="flex-1 overflow-y-auto px-1 py-1">
                {loading ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                ) : null}

                {loadError ? (
                    <p className="px-3 py-4 text-[11px] text-destructive">
                        Could not load credentials: {loadError}
                    </p>
                ) : null}

                {showEmpty ? (
                    <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                        {otpOnly
                            ? "No saved item has a one-time code for this site."
                            : "No saved credentials for this site."}
                    </p>
                ) : null}

                {!loading && matches.length ? (
                    <CredSection
                        label="Matching credentials"
                        creds={matches}
                        otpOnly={otpOnly}
                    />
                ) : null}
            </div>
        </div>
    );
};

const CredSection: React.FC<{
    label: string;
    creds: LiteCredential[];
    otpOnly: boolean;
}> = ({ label, creds, otpOnly }) => {
    return (
        <section>
            <h2 className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
            </h2>
            <ul className="px-1">
                {creds.map((c) => (
                    <li key={c.id}>
                        <button
                            type="button"
                            onClick={() =>
                                postToParent({
                                    kind: "pick",
                                    credentialId: c.id,
                                    useTotpOnly: otpOnly,
                                })
                            }
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                                <Key className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                    {c.name || c.username || "Untitled"}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                    {c.username || c.url || ""}
                                </span>
                            </span>
                            {c.hasTOTP ? (
                                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
                                    OTP
                                </span>
                            ) : null}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
