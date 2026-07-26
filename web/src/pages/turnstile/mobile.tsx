import { useCallback, useEffect, useMemo, useRef } from "react";
import type { NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

import { env } from "@/env/client.mjs";

/**
 * Minimal hosted Turnstile bridge for the native mobile WebView.
 * Posts strict JSON to window.ReactNativeWebView - never puts tokens in the URL,
 * cookies, logs, or visible DOM.
 *
 * Query `action` must be allowlisted (auth_register | auth_recover); arbitrary
 * values are rejected. Instance nonce is bridge correlation only (not Turnstile cData).
 */

type BridgeMessage =
    | { type: "ready"; instanceNonce: string }
    | { type: "success"; instanceNonce: string; token: string }
    | { type: "error"; instanceNonce: string; message: string }
    | { type: "expired"; instanceNonce: string }
    | { type: "timeout"; instanceNonce: string };
type TerminalBridgeMessage = Exclude<BridgeMessage, { type: "ready" }>;

declare global {
    interface Window {
        ReactNativeWebView?: {
            postMessage: (message: string) => void;
        };
    }
}

const CHALLENGE_TIMEOUT_MS = 90_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ALLOWED_ACTIONS = ["auth_register", "auth_recover"] as const;
type TurnstileBridgeAction = (typeof ALLOWED_ACTIONS)[number];

function isAllowedAction(value: string): value is TurnstileBridgeAction {
    return (ALLOWED_ACTIONS as readonly string[]).includes(value);
}

function postBridgeMessage(message: BridgeMessage): void {
    const payload = JSON.stringify(message);
    window.ReactNativeWebView?.postMessage(payload);
}

const TurnstileMobileBridgePage: NextPage = () => {
    const router = useRouter();
    const widgetRef = useRef<TurnstileInstance | null>(null);
    const terminalRef = useRef(false);
    const timerRef = useRef<number | null>(null);
    const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

    const instanceNonce = useMemo(() => {
        const raw = router.query.nonce;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value !== "string" || !NONCE_PATTERN.test(value)) {
            return null;
        }
        return value;
    }, [router.query.nonce]);

    const action = useMemo(() => {
        const raw = router.query.action;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value !== "string" || !isAllowedAction(value)) {
            return null;
        }
        return value;
    }, [router.query.action]);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const emitTerminal = useCallback(
        (message: TerminalBridgeMessage) => {
            if (terminalRef.current) return;
            terminalRef.current = true;
            clearTimer();
            postBridgeMessage(message);
        },
        [clearTimer],
    );

    useEffect(() => {
        terminalRef.current = false;
        clearTimer();
        return clearTimer;
    }, [action, clearTimer, instanceNonce]);

    useEffect(() => {
        if (!router.isReady) return;
        if (!instanceNonce) {
            postBridgeMessage({
                type: "error",
                instanceNonce: "invalid",
                message: "Missing or invalid challenge nonce.",
            });
            return;
        }
        if (!action) {
            emitTerminal({
                type: "error",
                instanceNonce,
                message: "Missing or invalid challenge action.",
            });
            return;
        }
        if (!siteKey) {
            emitTerminal({
                type: "error",
                instanceNonce,
                message: "Turnstile site key is not configured.",
            });
            return;
        }
    }, [action, emitTerminal, instanceNonce, router.isReady, siteKey]);

    const handleWidgetLoad = useCallback(() => {
        if (!instanceNonce || !action || terminalRef.current) return;
        postBridgeMessage({ type: "ready", instanceNonce });
        clearTimer();
        timerRef.current = window.setTimeout(() => {
            emitTerminal({ type: "timeout", instanceNonce });
            widgetRef.current?.remove();
        }, CHALLENGE_TIMEOUT_MS);
    }, [action, clearTimer, emitTerminal, instanceNonce]);

    return (
        <>
            <Head>
                <title>Cryptex Vault — Verification</title>
                <meta name="robots" content="noindex,nofollow" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=1"
                />
            </Head>
            <main
                style={{
                    minHeight: "100vh",
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#181d2b",
                    color: "#fcf8ec",
                    fontFamily:
                        "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
                }}
            >
                {!router.isReady || !instanceNonce || !action || !siteKey ? (
                    <p style={{ fontSize: 14, opacity: 0.8 }}>
                        Preparing verification…
                    </p>
                ) : (
                    <Turnstile
                        ref={widgetRef}
                        siteKey={siteKey}
                        options={{
                            action,
                            theme: "dark",
                            size: "normal",
                            appearance: "always",
                        }}
                        onWidgetLoad={handleWidgetLoad}
                        onSuccess={(token) => {
                            emitTerminal({
                                type: "success",
                                instanceNonce,
                                token,
                            });
                        }}
                        onError={() => {
                            emitTerminal({
                                type: "error",
                                instanceNonce,
                                message: "Turnstile challenge failed.",
                            });
                        }}
                        onExpire={() => {
                            emitTerminal({ type: "expired", instanceNonce });
                        }}
                        onTimeout={() => {
                            emitTerminal({ type: "timeout", instanceNonce });
                        }}
                    />
                )}
            </main>
        </>
    );
};

export default TurnstileMobileBridgePage;
