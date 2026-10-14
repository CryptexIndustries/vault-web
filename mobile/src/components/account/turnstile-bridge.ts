import { z } from "zod";

import { env } from "@/env";

export const TURNSTILE_BRIDGE_PATH = "/turnstile/mobile";

/** Allowlisted Turnstile actions; never trust arbitrary query values. */
const TURNSTILE_ACTIONS = [
    "auth_register",
    "auth_recover",
    "backup_recovery",
] as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];

function isTurnstileAction(value: unknown): value is TurnstileAction {
    return (
        typeof value === "string" &&
        (TURNSTILE_ACTIONS as readonly string[]).includes(value)
    );
}

const turnstileBridgeMessageSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("ready"),
        instanceNonce: z.string().min(8).max(128),
    }),
    z.object({
        type: z.literal("success"),
        instanceNonce: z.string().min(8).max(128),
        token: z.string().min(1).max(2048),
    }),
    z.object({
        type: z.literal("error"),
        instanceNonce: z.string().min(1).max(128),
        message: z.string().min(1).max(512),
    }),
    z.object({
        type: z.literal("expired"),
        instanceNonce: z.string().min(8).max(128),
    }),
    z.object({
        type: z.literal("timeout"),
        instanceNonce: z.string().min(8).max(128),
    }),
]);

type TurnstileBridgeMessage = z.infer<
    typeof turnstileBridgeMessageSchema
>;

export function isTurnstileConfigured(): boolean {
    return (env.TURNSTILE_SITE_KEY?.trim() ?? "").length > 0;
}

export function createTurnstileInstanceNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getTurnstileBridgeOrigin(): string {
    return env.APP_URL.replace(/\/+$/, "");
}

export function buildTurnstileBridgeUrl(
    instanceNonce: string,
    action: TurnstileAction,
): string {
    if (!isTurnstileAction(action)) {
        throw new Error("Turnstile action is not allowlisted.");
    }
    const origin = getTurnstileBridgeOrigin();
    const url = new URL(`${origin}${TURNSTILE_BRIDGE_PATH}`);
    url.searchParams.set("nonce", instanceNonce);
    url.searchParams.set("action", action);
    return url.toString();
}

/**
 * Production must load the bridge over HTTPS from the app origin.
 * Dev may use http://localhost (or LAN) for EXPO_PUBLIC_APP_URL.
 */
export function assertTurnstileBridgeUrlAllowed(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }

    const appOrigin = getTurnstileBridgeOrigin();
    let appUrl: URL;
    try {
        appUrl = new URL(appOrigin);
    } catch {
        return false;
    }

    if (parsed.origin !== appUrl.origin) return false;
    if (parsed.pathname !== TURNSTILE_BRIDGE_PATH) return false;
    if (!isTurnstileAction(parsed.searchParams.get("action"))) return false;

    const isLocalHttp =
        (parsed.hostname === "localhost" ||
            parsed.hostname === "127.0.0.1" ||
            parsed.hostname.endsWith(".local")) &&
        parsed.protocol === "http:";

    // Headed emulator review uses a release APK with adb-reversed loopback.
    const localReview =
        process.env.EXPO_PUBLIC_CRYPTEX_E2E === "1" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if ((__DEV__ || localReview) && isLocalHttp) return true;
    return parsed.protocol === "https:";
}

/**
 * Android's modern WebMessageListener reports only the posting frame's origin,
 * while older WebView bridges report the full document URL.
 */
export function isAllowedTurnstileMessageSource(
    sourceUrl: string,
    bridgeUrl: string,
): boolean {
    if (!assertTurnstileBridgeUrlAllowed(bridgeUrl)) return false;

    let source: URL;
    let bridge: URL;
    try {
        source = new URL(sourceUrl);
        bridge = new URL(bridgeUrl);
    } catch {
        return false;
    }

    if (source.origin !== bridge.origin) return false;

    const isOriginOnly =
        source.pathname === "/" && source.search === "" && source.hash === "";
    return isOriginOnly || source.href === bridge.href;
}

export function isAllowedTurnstileNavigationUrl(url: string): boolean {
    if (url === "about:blank" || url === "about:srcdoc") return true;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }

    if (parsed.protocol === "about:") {
        return parsed.pathname === "blank" || parsed.pathname === "srcdoc";
    }

    // Cloudflare challenge frames: HTTPS only (no plain-http exception).
    if (parsed.hostname === "challenges.cloudflare.com") {
        return parsed.protocol === "https:";
    }

    return assertTurnstileBridgeUrlAllowed(url);
}

export function parseTurnstileBridgeMessage(
    raw: string,
): TurnstileBridgeMessage | null {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return null;
    }
    const parsed = turnstileBridgeMessageSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
}
