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

export default HTMLHeader;
