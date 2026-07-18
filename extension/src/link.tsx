import { createRoot } from "react-dom/client";
import { Shield, ShieldCheck } from "lucide-react";

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
        <div className="dark min-h-screen bg-background bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_38%)] py-8 text-foreground sm:py-12">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4">
                <header className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className="rounded-md bg-primary/15 p-2 text-primary">
                            <Shield className="h-5 w-5" />
                        </span>
                        <div>
                            <h1 className="text-base font-semibold">
                                Cryptex Vault
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Browser extension setup
                            </p>
                        </div>
                    </div>
                    <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                        End-to-end encrypted
                    </span>
                </header>

                <div className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-lg">
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
