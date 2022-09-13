import { BuiltInProviderType } from "next-auth/providers";
import {
    ClientSafeProvider,
    getProviders,
    LiteralUnion,
} from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import NavBar from "../components/index/navbar";
import LoginModal from "../components/login/loginModal";

type IndexProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const index: React.FC<IndexProps> = ({ providers }) => {
    const { query } = useRouter();

    return (
        <>
            <NavBar />

            <div className="content">
                <h1>Buy our awesome product!</h1>
            </div>
        </>
    );
};

export default index;
