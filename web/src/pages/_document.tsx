import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html lang="en">
            <Head>
                {/* Blocking by design: application modules read this global at
                    evaluation time, before React hydrates the static HTML. */}
                {/* oxlint-disable-next-line next/no-sync-scripts -- Runtime configuration must load before the deferred Next.js bundles. */}
                <script src="/runtime-config.js" />
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
