// src/pages/login

import { GetServerSidePropsContext } from "next";
import { BuiltInProviderType } from "next-auth/providers";
import {
    ClientSafeProvider,
    getProviders,
    LiteralUnion,
    signIn,
} from "next-auth/react";
import { getServerAuthSession } from "../server/common/get-server-auth-session";

export type LoginProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const Login: React.FC<LoginProps> = ({ providers }) => {
    return (
        <div className="flex w-screen h-screen justify-center items-center drop-shadow-lg">
            <div className="flex flex-col items-center border-2 p-4 rounded-lg bg-gray-100">
                <div className="text-2xl py-5">
                    <h1>Sign In</h1>
                </div>
                <div className="flex flex-col items-center">
                    {Object.values(providers ?? []).map((provider) => {
                        return (
                            <div key={provider.name + "-container"}>
                                {provider.id !== "cryptex" ? null : (
                                    <hr
                                        key={provider.name + "-divider"}
                                        className="w-9/12 my-5 bg-black border-2"
                                    />
                                )}
                                <SignInCard
                                    key={provider.name}
                                    serviceName={provider.name}
                                    serviceLogo={provider.id}
                                    serviceID={provider.id}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

type SignInCardProps = {
    available?: boolean;
    serviceName: string;
    serviceID: string;
    serviceLogo: string;
};

const SignInCard: React.FC<SignInCardProps> = ({
    available = true,
    serviceName,
    serviceLogo,
    serviceID,
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
            onClick={() => signIn(serviceID)}
        >
            <div className="flex flex-row w-full justify-between items-center ">
                <div>
                    <img
                        src={`images/brand_images/${serviceLogo}.svg`}
                        style={{
                            width: iconSize,
                            height: iconSize,
                            marginLeft: marginLeft,
                        }}
                    />
                </div>
                <p className={`text-gray-200`}>Sign In with {serviceName}</p>
                <div></div>
            </div>
        </button>
    );
};

export const getServerSideProps = async (ctx: GetServerSidePropsContext) => {
    const session = await getServerAuthSession(ctx);

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
