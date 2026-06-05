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

type ParentMessage =
    | { kind: "use"; password: string }
    | { kind: "close" };

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
        const onBootstrap = (event: MessageEvent) => {
            if (event.source !== window.parent) return;
            const data = event.data as { kind?: string } | undefined;
            if (data?.kind !== "init") return;
            const port = event.ports?.[0];
            if (!port) return;
            window.removeEventListener("message", onBootstrap);
            outboundPort = port;
            port.start();
        };

        window.addEventListener("message", onBootstrap);

        try {
            window.parent.postMessage({ kind: "ready" }, "*");
        } catch (err) {
            uiLog.warn("[autofill-generator] ready post failed", { err });
        }

        return () => {
            window.removeEventListener("message", onBootstrap);
            if (outboundPort) {
                outboundPort.close();
                outboundPort = null;
            }
        };
    }, []);

    return (
        <div className="dark autofill-generator-panel">
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
