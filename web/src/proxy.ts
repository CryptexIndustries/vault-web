import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/env/public";
import {
    createContentSecurityPolicy,
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

export function proxy(request: NextRequest) {
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
