/**
 * Inline password generator iframe for registration/signup forms.
 *
 * Mounted by the content script when the user clicks the key icon on a
 * password field. Reuses the vault's PasswordGeneratorPanel and sends
 * the chosen password back to the parent over a MessageChannel port.
 */

import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import "./autofill-generator.css";

import { PasswordGeneratorPanel } from "@/components/ui/password-generator";
import { uiLog } from "./utils/ext-logging";
import {
    claimAutofillFrameBootstrap,
    isExpectedAutofillInit,
} from "./utils/autofill-frame-bootstrap";

type ParentMessage = { kind: "use"; password: string } | { kind: "close" };

let outboundPort: MessagePort | null = null;

function postToParent(message: ParentMessage): void {
    if (!outboundPort) return;
    try {
        outboundPort.postMessage(message);
    } catch (err) {
        uiLog.warn("[autofill-generator] post failed", { err });
    }
}

const App = () => {
    useEffect(() => {
        let cancelled = false;
        let onBootstrap: ((event: MessageEvent) => void) | null = null;

        void claimAutofillFrameBootstrap("autofill-generator").then(
            (bootstrap) => {
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
                    port.start();
                };

                window.addEventListener("message", onBootstrap);

                try {
                    window.parent.postMessage(
                        { kind: "ready", mountId: bootstrap.mountId },
                        "*",
                    );
                } catch (err) {
                    uiLog.warn("[autofill-generator] ready post failed", {
                        err,
                    });
                }
            },
        );

        return () => {
            cancelled = true;
            if (onBootstrap) {
                window.removeEventListener("message", onBootstrap);
            }
            if (outboundPort) {
                outboundPort.close();
                outboundPort = null;
            }
        };
    }, []);

    return (
        <div className="autofill-generator-panel dark">
            <PasswordGeneratorPanel
                compact
                onCancel={() => postToParent({ kind: "close" })}
                onPasswordSelect={(password) =>
                    postToParent({ kind: "use", password })
                }
            />
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
