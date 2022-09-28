// src/pages/login

import { GetServerSidePropsContext, NextPage } from "next";
import { BuiltInProviderType } from "next-auth/providers";
import {
    ClientSafeProvider,
    getProviders,
    LiteralUnion,
    signIn,
} from "next-auth/react";
import Head from "next/head";
import { useState } from "react";
import { toast } from "react-toastify";
import LoginModal, { FormMode } from "../components/login/loginModal";
import { getServerAuthSession } from "../server/common/get-server-auth-session";
import { useRouter } from "next/router";
import NotificationContainer from "../components/general/notificationContainer";
import Image from "next/image";

export type LoginProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const Login: NextPage<LoginProps> = ({ providers }) => {
    const queryString = useRouter();

    const [cryptexAuthModalVisible, setCryptexAuthModelVisible] =
        useState(false);
    const showCryptexAuthModal = () => setCryptexAuthModelVisible(true);
    const hideCryptexAuthModal = () => setCryptexAuthModelVisible(false);

    // If the error query parameter is set, display an error message in nextjs
    const error = queryString.query.error;
    if (error) {
        toast.error("Authentication failed. Please try again.", {
            toastId: "auth-error",
            onClose() {
                // Only show the console message once
                console.error(error);
                // Then remove the query parameter from the URL
                queryString.replace(queryString.pathname);
            },
        });
    }

    return (
        <>
            <Head>
                <title>Cryptex Vault - Login</title>
                <meta
                    name="description"
                    content="Log into your Cryptex Vault account using various Identity Providers."
                />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main className="main">
                <div className="flex flex-col w-screen h-screen justify-center items-center drop-shadow-lg">
                    <Image
                        src={"/images/logo/Welcome_Banner.png"}
                        alt=""
                        width={400}
                        height={400}
                    />
                    <div className="flex flex-col items-center border-2 p-4 rounded-lg card">
                        <h1 className="text-3xl pt-2 pb-7">Sign In</h1>
                        <div className="flex flex-col items-center">
                            {Object.values(providers ?? []).map((provider) => {
                                return (
                                    <div
                                        key={provider.name + "-container"}
                                        className="flex flex-col items-center"
                                    >
                                        {provider.id !== "cryptex" ? null : (
                                            <hr
                                                key={provider.name + "-divider"}
                                                className="w-9/12 my-5 bg-black border-2 border-gray-700"
                                            />
                                        )}
                                        <SignInCard
                                            key={provider.name}
                                            serviceName={provider.name}
                                            serviceLogo={provider.id}
                                            serviceID={provider.id}
                                            cryptexLoginModalTriggerFn={
                                                showCryptexAuthModal
                                            }
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </main>
            <LoginModal
                visible={cryptexAuthModalVisible}
                hideModalFn={hideCryptexAuthModal}
                formMode={FormMode.Any}
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
    cryptexLoginModalTriggerFn?: () => void;
};

const SignInCard: React.FC<SignInCardProps> = ({
    available = true,
    serviceName,
    serviceLogo,
    serviceID,
    cryptexLoginModalTriggerFn,
}) => {
    const iconSize = serviceID === "gitlab" ? 50 : 30;
    const marginLeft = serviceID === "gitlab" ? 0 : 10;
    return (
        <button
            className={`font-bold w-96 my-2 py-2 px-4 rounded inline-flex items-center border-black transition-colors
            bg-gray-600 ${available ? "hover:bg-gray-500" : "opacity-50"} ${
                available ? "cursor-pointer" : "cursor-default"
            } h-16`}
            disabled={!available}
            onClick={() => {
                if (serviceID !== "cryptex") {
                    signIn(serviceID);
                } else {
                    if (cryptexLoginModalTriggerFn != null)
                        cryptexLoginModalTriggerFn();
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
                        style={{ marginLeft: marginLeft }}
                    />
                </div>
                <p className="text-gray-200">Sign In with {serviceName}</p>
                {/* This empty element is needed so we can center the text */}
                <div></div>
            </div>
        </button>
    );
};

export const getServerSideProps = async (ctx: GetServerSidePropsContext) => {
    const session = await getServerAuthSession(ctx);

    // If the user already has a session, redirect them to the account page
    if (session) {
        return {
            redirect: {
                destination: "/account",
                permanent: false,
            },
        };
    }

    // Get the providers only if the user actually doesn't have a session
    const providers = await getProviders();

    return {
        props: {
            session,
            providers,
        },
    };
};

export default Login;
