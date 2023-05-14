import Head from "next/head";

export type HTMLHeaderProps = {
    title: string;
    description: string;
    favicon?: string;
};

const HTMLHeader: React.FC<HTMLHeaderProps> = ({
    title,
    description,
    favicon = "/favicon.ico",
}) => {
    return (
        <Head>
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
            />
            <meta charSet="utf-8" />
            <title>{title}</title>
            <meta name="description" content={description} />
            <link rel="icon" href={favicon} />
        </Head>
    );
};

export const HTMLHeaderPWA: React.FC<HTMLHeaderProps> = ({
    title,
    description,
    favicon = "/favicon.ico",
}) => {
    return (
        <Head>
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
            />
            <meta charSet="utf-8" />
            <title>{title}</title>
            <meta name="description" content={description} />
            <link rel="icon" href={favicon} />
            <link rel="manifest" href="/app/manifest.webmanifest" />

            <meta name="application-name" content="CryptexVault" />

            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta
                name="apple-mobile-web-app-status-bar-style"
                content="default"
            />
            <meta name="apple-mobile-web-app-title" content="CryptexVault" />

            <meta name="description" content="Decentralized Identity Manager" />
            <meta name="format-detection" content="telephone=no" />

            {/* <meta
                name="msapplication-config"
                content="/icons/browserconfig.xml"
            /> */}
            <meta name="msapplication-TileColor" content="#2B5797" />
            <meta name="msapplication-tap-highlight" content="no" />
            <meta name="theme-color" content="#000000" />

            {/* <link rel="apple-touch-icon" href="/icons/touch-icon-iphone.png" />
            <link
                rel="apple-touch-icon"
                sizes="152x152"
                href="/icons/touch-icon-ipad.png"
            /> */}
            <link
                rel="apple-touch-icon"
                sizes="180x180"
                href="/images/pwa/touch-icon-iphone-retina.png"
            />
            {/* <link
                rel="apple-touch-icon"
                sizes="167x167"
                href="/icons/touch-icon-ipad-retina.png"
            /> */}

            {/* <link
                rel="icon"
                type="image/png"
                sizes="32x32"
                href="/icons/favicon-32x32.png"
            />
            <link
                rel="icon"
                type="image/png"
                sizes="16x16"
                href="/icons/favicon-16x16.png"
            /> */}
            {/* <link
                rel="mask-icon"
                href="/icons/safari-pinned-tab.svg"
                color="#5bbad5"
            /> */}
            {/* <link rel="shortcut icon" href="/favicon.ico" /> */}
            {/* <link
                rel="stylesheet"
                href="https://fonts.googleapis.com/css?family=Roboto:300,400,500"
            /> */}

            <meta name="twitter:card" content="summary" />
            <meta name="twitter:url" content="https://cryptex-vault.com/app" />
            <meta name="twitter:title" content="CryptexVault" />
            <meta
                name="twitter:description"
                content="Decentralized Identity Manager"
            />
            {/* <meta
                name="twitter:image"
                content="https://yourdomain.com/icons/android-chrome-192x192.png"
            /> */}
            {/* <meta name="twitter:creator" content="@DavidWShadow" /> */}
            <meta property="og:type" content="website" />
            <meta property="og:title" content="CryptexVault" />
            <meta
                property="og:description"
                content="Decentralized Identity Manager"
            />
            <meta property="og:site_name" content="CryptexVault" />
            <meta property="og:url" content="https://cryptex-vault.com" />
            {/* <meta
                property="og:image"
                content="https://yourdomain.com/icons/apple-touch-icon.png"
            /> */}

            {/* <!-- apple splash screen images --> */}
            {/* <!--
            <link rel='apple-touch-startup-image' href='/images/apple_splash_2048.png' sizes='2048x2732' />
            <link rel='apple-touch-startup-image' href='/images/apple_splash_1668.png' sizes='1668x2224' />
            <link rel='apple-touch-startup-image' href='/images/apple_splash_1536.png' sizes='1536x2048' />
            <link rel='apple-touch-startup-image' href='/images/apple_splash_1125.png' sizes='1125x2436' />
            <link rel='apple-touch-startup-image' href='/images/apple_splash_1242.png' sizes='1242x2208' />
            <link rel='apple-touch-startup-image' href='/images/apple_splash_750.png' sizes='750x1334' />
            <link rel='apple-touch-startup-image' href='/images/apple_splash_640.png' sizes='640x1136' />
            --> */}
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2048-2732.jpg"
                media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2732-2048.jpg"
                media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1668-2388.jpg"
                media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2388-1668.jpg"
                media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1536-2048.jpg"
                media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2048-1536.jpg"
                media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1668-2224.jpg"
                media="(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2224-1668.jpg"
                media="(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1620-2160.jpg"
                media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2160-1620.jpg"
                media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1290-2796.jpg"
                media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2796-1290.jpg"
                media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1179-2556.jpg"
                media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2556-1179.jpg"
                media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1284-2778.jpg"
                media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2778-1284.jpg"
                media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1170-2532.jpg"
                media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2532-1170.jpg"
                media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1125-2436.jpg"
                media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2436-1125.jpg"
                media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1242-2688.jpg"
                media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2688-1242.jpg"
                media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-828-1792.jpg"
                media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1792-828.jpg"
                media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1242-2208.jpg"
                media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-2208-1242.jpg"
                media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-750-1334.jpg"
                media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1334-750.jpg"
                media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-640-1136.jpg"
                media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="/images/pwa/apple-splash-1136-640.jpg"
                media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />

            {/* Apple splash screen images dark mode */}
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2048-2732.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2732-2048.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1668-2388.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2388-1668.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1536-2048.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2048-1536.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1668-2224.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2224-1668.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1620-2160.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2160-1620.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1290-2796.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2796-1290.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1179-2556.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2556-1179.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1284-2778.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2778-1284.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1170-2532.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2532-1170.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1125-2436.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2436-1125.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1242-2688.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2688-1242.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-828-1792.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1792-828.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1242-2208.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-2208-1242.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-750-1334.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1334-750.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-640-1136.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
            />
            <link
                rel="apple-touch-startup-image"
                href="public/images/pwa/apple-splash-dark-1136-640.jpg"
                media="(prefers-color-scheme: dark) and (device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
            />
        </Head>
    );
};

export default HTMLHeader;
