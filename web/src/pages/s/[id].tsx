import type { NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { ShareReveal } from "@/components/share/share-reveal";

/**
 * Public page for one-time share links: /s/<id>#<secret>.
 * The secret in the fragment never reaches a server.
 */
const SharedSecretPage: NextPage = () => {
    const router = useRouter();
    const id = router.isReady
        ? typeof router.query.id === "string"
            ? router.query.id
            : ""
        : undefined;

    return (
        <>
            <Head>
                <title>Cryptex Vault - Shared secret</title>
                <meta name="robots" content="noindex, nofollow" />
                <meta name="referrer" content="no-referrer" />
            </Head>
            <ShareReveal id={id} />
        </>
    );
};

export default SharedSecretPage;
