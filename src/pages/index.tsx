import { BuiltInProviderType } from "next-auth/providers";
import { ClientSafeProvider, LiteralUnion } from "next-auth/react";
import Head from "next/head";
import NavBar from "../components/index/navbar";

type IndexProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const index: React.FC<IndexProps> = ({ providers }) => {
    return (
        <>
            <Head>
                <title>Cryptex Vault</title>
                <meta name="description" content="" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main>
                <NavBar />

                <div className="content">
                    <h1>Buy our awesome product!</h1>
                </div>
            </main>
        </>
    );
};

export default index;
