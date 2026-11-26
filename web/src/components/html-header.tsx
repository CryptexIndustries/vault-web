import Head from "next/head";

export type HTMLHeaderProps = {
    title: string;
    description: string;
    favicon?: string;
    /** Absolute page URL. Adds canonical and link preview tags when set. */
    url?: string;
};

const HTMLHeader: React.FC<HTMLHeaderProps> = ({
    title,
    description,
    favicon = "/images/cryptex-vault-logo.svg",
    url,
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
            <link rel="icon" type="image/svg+xml" href={favicon} />
            {url && (
                <>
                    <link rel="canonical" href={url} />
                    <meta property="og:type" content="website" />
                    <meta property="og:title" content={title} />
                    <meta property="og:description" content={description} />
                    <meta property="og:url" content={url} />
                    <meta
                        property="og:image"
                        content={new URL("/images/og-image.png", url).href}
                    />
                    <meta name="twitter:card" content="summary_large_image" />
                </>
            )}
        </Head>
    );
};

export default HTMLHeader;
