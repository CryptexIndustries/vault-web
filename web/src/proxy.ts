import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/env/public";
import {
    createContentSecurityPolicy,
    shareRecipientContentSecurityPolicy,
    turnstileMobileContentSecurityPolicy,
} from "@/env/content-security-policy";
import { createRuntimeConfigScript } from "@/env/runtime-config-script";

const RUNTIME_CONFIG_PATH = "/runtime-config.js";

const runtimeConfigHeaders = {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/javascript; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
};

const SHARE_API_PREFIX = "/share-api/";
const SHARE_PAGE_PREFIX = "/s/";

/**
 * The share server runs next to this container. Forwarding keeps the API on
 * the same origin as the /s/<id> page, so a link names its own server and the
 * recipient page only needs connect-src 'self'.
 */
function forwardToShareServer(request: NextRequest) {
    const target = process.env.SHARE_SERVER_INTERNAL_URL;
    if (!target) {
        return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    const url = new URL(request.nextUrl.pathname, target);
    url.search = request.nextUrl.search;
    return NextResponse.rewrite(url);
}

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith(SHARE_API_PREFIX)) {
        return forwardToShareServer(request);
    }
    if (request.nextUrl.pathname === RUNTIME_CONFIG_PATH) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new NextResponse(null, {
                status: 405,
                headers: {
                    ...runtimeConfigHeaders,
                    Allow: "GET, HEAD",
                },
            });
        }

        return new NextResponse(createRuntimeConfigScript(env), {
            headers: runtimeConfigHeaders,
        });
    }

    const response = NextResponse.next();
    if (pathname.startsWith(SHARE_PAGE_PREFIX)) {
        response.headers.set(
            "Content-Security-Policy",
            shareRecipientContentSecurityPolicy(
                process.env.NODE_ENV === "development",
            ),
        );
        response.headers.set("Referrer-Policy", "no-referrer");
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
        return response;
    }
    const isTurnstileMobile =
        request.nextUrl.pathname === "/turnstile/mobile" ||
        request.nextUrl.pathname === "/turnstile/mobile/";

    response.headers.set(
        "Content-Security-Policy",
        isTurnstileMobile
            ? turnstileMobileContentSecurityPolicy
            : createContentSecurityPolicy(env),
    );
    return response;
}

export const config = {
    matcher: [
        "/((?!api|_next/static|_next/image|images|fonts|wasm-libs|robots.txt|favicon.ico).*)",
    ],
};
