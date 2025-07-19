// src/pages/_app.tsx
import { withTRPC } from "@trpc/next";
import { Provider } from "jotai/react";
import type { AppType } from "next/dist/shared/lib/utils";
import superjson from "superjson";
import type { VersionedRouter } from "../server/trpc";
import "../styles/globals.css";
import { vaultStore } from "../utils/atoms";
import { reactQueryClientConfig } from "../utils/trpc";

const MyApp: AppType = ({ Component, pageProps: { ...pageProps } }) => {
    return (
        <Provider store={vaultStore}>
            <Component {...pageProps} />
        </Provider>
    );
};

const getBaseUrl = () => {
    if (typeof window !== "undefined") return ""; // browser should use relative url
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url
    return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

export default withTRPC<VersionedRouter>({
    config: () => reactQueryClientConfig(getBaseUrl()),
    /**
     * @link https://trpc.io/docs/ssr
     */
    ssr: false,
    transformer: superjson,
})(MyApp);
