export type ExtensionProductionEnv = {
    VITE_APP_URL?: string;
    VITE_PUSHER_APP_ID?: string;
    VITE_PUSHER_APP_KEY?: string;
    VITE_PUSHER_APP_HOST?: string;
    VITE_PUSHER_APP_PORT?: string;
    VITE_PUSHER_APP_TLS?: string;
    VITE_ONLINE_SERVICES_API_URL?: string;
    VITE_CLOUD_ENABLED?: string;
};

export function validateProductionEnv(env: ExtensionProductionEnv): void {
    const invalid = (
        key: keyof ExtensionProductionEnv,
        reason: string,
    ): never => {
        throw new Error(
            `Invalid ${key} for production extension: ${reason}. ` +
                "Set it in the build environment or extension/.env.production.local.",
        );
    };

    const required = (key: keyof ExtensionProductionEnv): string => {
        const value = env[key];
        if (!value || /\s/.test(value) || value.includes("REPLACE_ME")) {
            return invalid(
                key,
                "a non-placeholder value without whitespace is required",
            );
        }
        return value;
    };

    const httpsOrigin = (key: keyof ExtensionProductionEnv, value: string) => {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return invalid(key, "a valid HTTPS origin is required");
        }
        if (
            !value.startsWith("https://") ||
            /[\s\\]/.test(value) ||
            value.includes("REPLACE_ME") ||
            url.protocol !== "https:" ||
            !url.hostname ||
            url.port === "0" ||
            url.username ||
            url.password ||
            url.pathname !== "/" ||
            value.includes("?") ||
            value.includes("#")
        ) {
            invalid(
                key,
                "use an HTTPS origin without credentials, a path, query, or fragment",
            );
        }
    };

    const boolean = (
        key: keyof ExtensionProductionEnv,
        requiredValue = false,
    ) => {
        const value = requiredValue ? required(key) : env[key];
        if (value == null || value === "") return;
        if (!["true", "false"].includes(value.toLowerCase())) {
            invalid(key, 'use "true" or "false"');
        }
    };

    httpsOrigin("VITE_APP_URL", required("VITE_APP_URL"));
    required("VITE_PUSHER_APP_ID");
    required("VITE_PUSHER_APP_KEY");

    const host = required("VITE_PUSHER_APP_HOST");
    try {
        // Parsing also rejects malformed IPv4 and bracketed IPv6 addresses.
        const url = new URL(`https://${host}`);
        const ipv6 = host.startsWith("[") && host.endsWith("]");
        const validDomain = host
            .replace(/\.$/, "")
            .split(".")
            .every((label) =>
                /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
            );
        if (
            host.length > 253 ||
            /[\s/@?#\\]/.test(host) ||
            (!ipv6 && !validDomain) ||
            url.port ||
            url.username ||
            url.password ||
            url.pathname !== "/"
        ) {
            invalid(
                "VITE_PUSHER_APP_HOST",
                "use a hostname without a scheme, port, or path",
            );
        }
    } catch {
        invalid(
            "VITE_PUSHER_APP_HOST",
            "use a valid hostname without a scheme, port, or path",
        );
    }

    const port = required("VITE_PUSHER_APP_PORT");
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        invalid("VITE_PUSHER_APP_PORT", "use an integer from 1 to 65535");
    }

    boolean("VITE_PUSHER_APP_TLS", true);
    boolean("VITE_CLOUD_ENABLED");
    if (env.VITE_ONLINE_SERVICES_API_URL) {
        httpsOrigin(
            "VITE_ONLINE_SERVICES_API_URL",
            env.VITE_ONLINE_SERVICES_API_URL,
        );
    }
}
