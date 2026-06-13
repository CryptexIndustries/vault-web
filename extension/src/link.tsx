import { createRoot } from "react-dom/client";
import { Shield } from "lucide-react";

import "./link.css";
import { Toaster } from "@/components/ui/sonner";

import PopupReceiveLink from "./components/popup-receive-link";
import { uiLog } from "./utils/ext-logging";

const closeTabSoon = () => {
    if (typeof chrome === "undefined" || !chrome.tabs?.getCurrent) {
        return;
    }
    window.setTimeout(() => {
        chrome.tabs.getCurrent((tab) => {
            if (tab?.id == null) return;
            void chrome.tabs.remove(tab.id);
        });
    }, 1500);
};

const LinkPage = () => {
    return (
        <div className="dark min-h-screen bg-background py-10 text-foreground">
            <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4">
                <header className="flex items-center gap-3">
                    <span className="rounded-md bg-primary/15 p-2 text-primary">
                        <Shield className="h-5 w-5" />
                    </span>
                    <div>
                        <h1 className="text-base font-semibold">
                            Link Cryptex Vault
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Pair this browser with a vault from another device.
                            After linking you set a passphrase, then this tab
                            closes and you unlock from the extension popup.
                        </p>
                    </div>
                </header>

                <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg">
                    <PopupReceiveLink
                        onComplete={() => {
                            uiLog.info(
                                "Receive-link flow completed (full-tab); closing tab shortly",
                            );
                            closeTabSoon();
                        }}
                    />
                </div>
            </div>
            <Toaster />
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<LinkPage />);
