import type { NextApiRequest, NextApiResponse } from "next";
import { BuiltInProviderType } from "next-auth/providers";
import {
    ClientSafeProvider,
    getProviders,
    LiteralUnion,
    signIn,
    useSession,
} from "next-auth/react";
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import NotificationContainer from "../components/general/notificationContainer";
import LoginModal, { FormMode } from "../components/login/loginModal";
import { getServerAuthSession } from "../server/common/get-server-auth-session";

export type AccountProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const Account: React.FC<AccountProps> = ({ providers }) => {
    const router = useRouter();
    const { data: session } = useSession();

    const [cryptexAuthModalVisible, setCryptexAuthModelVisible] =
        useState(false);
    const showCryptexAuthModal = () => setCryptexAuthModelVisible(true);
    const hideCryptexAuthModal = () => setCryptexAuthModelVisible(false);

    useEffect(() => {
        // if the user has no session, redirect them to the login page
        if (!session) {
            router.push("/login");
        }
    }, [session, router]);

    if (!session) return null;

    return (
        <>
            <Head>
                <title>Cryptex Vault - Account</title>
                <meta
                    name="description"
                    content="Cryptex Vault Account Administration"
                />
                <link rel="icon" href="/favicon.ico" />
            </Head>
            <main className="main min-h-screen w-screen">
                <div className="flex justify-evenly pt-2 mb-5">
                    <p>
                        Hi, {session.user?.name} ({session.user?.email}) ID:
                        {session.user?.id}
                    </p>
                    <p> Session expires at {session.expires}</p>
                    <Link href="/api/auth/signout">
                        <a className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                            Sign out
                        </a>
                    </Link>
                </div>
                <div className="flex flex-col items-center">
                    <p className="text-2xl">Connect other services</p>
                    {Object.values(providers ?? []).map((provider) => (
                        <SignInCard
                            key={provider.name}
                            serviceName={provider.name}
                            serviceLogo={provider.id}
                            serviceID={provider.id}
                            cryptexConnectFn={
                                provider.id === "cryptex"
                                    ? showCryptexAuthModal
                                    : undefined
                            }
                        />
                    ))}
                </div>
            </main>
            <LoginModal
                visible={cryptexAuthModalVisible}
                hideModalFn={hideCryptexAuthModal}
                formMode={FormMode.SignUp}
                userEmail={session.user?.email}
            />
            <NotificationContainer />
        </>
    );
};

type SignInCardProps = {
    available?: boolean;
    serviceName: string;
    serviceID: string;
    serviceLogo: string;
    cryptexConnectFn?: () => void;
};

const SignInCard: React.FC<SignInCardProps> = ({
    available = true,
    serviceName,
    serviceLogo,
    serviceID,
    cryptexConnectFn,
}) => {
    const iconSize = serviceID === "gitlab" ? 50 : 30;
    const marginLeft = serviceID === "gitlab" ? 0 : 10;
    return (
        <button
            className={`font-bold w-96 my-2 py-2 px-4 rounded inline-flex items-center border-black 
            bg-gray-600 ${available ? "hover:bg-gray-500" : "opacity-50"} ${
                available ? "cursor-pointer" : "cursor-default"
            } h-16`}
            disabled={!available}
            onClick={() => {
                if (cryptexConnectFn) {
                    cryptexConnectFn();
                } else {
                    signIn(serviceID);
                }
            }}
        >
            <div className="flex flex-row w-full justify-between items-center ">
                <div>
                    {/* <img
                        src={`images/brand_images/${serviceLogo}.svg`}
                        style={{
                            width: iconSize,
                            height: iconSize,
                            marginLeft: marginLeft,
                        }}
                    /> */}
                    <Image
                        src={`/images/brand_images/${serviceLogo}.svg`}
                        alt={serviceLogo}
                        width={iconSize}
                        height={iconSize}
                        style={{
                            marginLeft: marginLeft,
                        }}
                    />
                </div>
                <p className={`text-gray-200`}>Connect {serviceName}</p>
                <div></div>
            </div>
        </button>
    );
};

export const getServerSideProps = async (ctx: {
    req: NextApiRequest;
    res: NextApiResponse;
}) => {
    const session = await getServerAuthSession({ req: ctx.req, res: ctx.res });
    const providers = await getProviders();
    return {
        props: {
            session,
            providers,
        },
    };
};

export default Account;
