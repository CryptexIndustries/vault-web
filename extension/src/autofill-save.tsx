/**
 * Persistent in-page save-login iframe.
 *
 * Mounted by the content script after a successful sign-in so the user
 * can keep interacting with the host page while deciding whether to
 * store the credential. Unlike the extension popup, this panel does
 * not steal focus from the tab.
 */

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./autofill-save.css";

import PopupSaveCredential from "./components/popup-save-credential";
import { type PendingSavePrompt } from "./types/sw-messaging";
import { uiLog } from "./utils/ext-logging";

type InitPayload = Omit<PendingSavePrompt, "stashedAt">;

type ParentMessage = { kind: "close" } | { kind: "resize"; height: number };

type IncomingMessage = { kind: "init"; payload: InitPayload };

let outboundPort: MessagePort | null = null;

function postToParent(message: ParentMessage): void {
    if (!outboundPort) return;
    try {
        outboundPort.postMessage(message);
    } catch (err) {
        uiLog.warn("[autofill-save] post failed", { err });
    }
}

function useReportPanelHeight(
    ref: React.RefObject<HTMLElement | null>,
    active: boolean,
    /** Re-attach when inner content swaps (e.g. loading → form). */
    contentKey: string | number | null,
): void {
    useEffect(() => {
        if (!active) return;
        const el = ref.current;
        if (!el) return;

        const report = () => {
            // scrollHeight reflects full form height even when the parent
            // iframe is still at its initial size (getBoundingClientRect
            // would report the clipped box and trap the iframe too short).
            const height = Math.ceil(
                Math.max(el.scrollHeight, el.getBoundingClientRect().height),
            );
            if (height > 0) {
                postToParent({ kind: "resize", height });
            }
        };

        report();
        const observer = new ResizeObserver(report);
        observer.observe(el);
        for (const child of el.children) {
            observer.observe(child);
        }
        return () => observer.disconnect();
    }, [ref, active, contentKey]);
}

const App = () => {
    const [prompt, setPrompt] = useState<PendingSavePrompt | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useReportPanelHeight(panelRef, true, prompt ? "ready" : "loading");

    useEffect(() => {
        const onPortMessage = (event: MessageEvent) => {
            const data = event.data as IncomingMessage | undefined;
            if (!data || typeof data !== "object") return;
            if (data.kind === "init") {
                setPrompt({
                    ...data.payload,
                    stashedAt: Date.now(),
                });
            }
        };

        const onBootstrap = (event: MessageEvent) => {
            if (event.source !== window.parent) return;
            const data = event.data as { kind?: string } | undefined;
            if (data?.kind !== "init") return;
            const port = event.ports?.[0];
            if (!port) return;
            window.removeEventListener("message", onBootstrap);
            outboundPort = port;
            port.onmessage = onPortMessage;
            port.start();
        };

        window.addEventListener("message", onBootstrap);

        try {
            window.parent.postMessage({ kind: "ready" }, "*");
        } catch (err) {
            uiLog.warn("[autofill-save] ready post failed", { err });
        }

        return () => {
            window.removeEventListener("message", onBootstrap);
            if (outboundPort) {
                outboundPort.onmessage = null;
                outboundPort.close();
                outboundPort = null;
            }
        };
    }, []);

    return (
        <div
            ref={panelRef}
            className="autofill-save-panel dark rounded-md border bg-popover/95 text-popover-foreground shadow-xl"
        >
            {!prompt ? (
                <div className="flex min-h-[4rem] items-center justify-center p-4">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                </div>
            ) : (
                <PopupSaveCredential
                    embedded
                    prompt={prompt}
                    onDone={() => postToParent({ kind: "close" })}
                />
            )}
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
