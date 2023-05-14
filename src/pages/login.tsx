// src/pages/login

import { NextApiRequest, NextApiResponse, NextPage } from "next";
import { BuiltInProviderType } from "next-auth/providers";
import { ClientSafeProvider, LiteralUnion } from "next-auth/react";
import { useState } from "react";
import { toast } from "react-toastify";
import LoginModal, { FormMode } from "../components/login/loginModal";
import { getServerAuthSession } from "../server/common/get-server-auth-session";
import { useRouter } from "next/router";
import NotificationContainer from "../components/general/notificationContainer";
import Image from "next/image";
import PageFooter from "../components/general/footer";
import HTMLHeader from "../components/html_header";
import HTMLMain from "../components/html_main";
import NavBar from "../components/navbar";
import {
    GetPriceID,
    PAYMENT_TIERS_LABELS,
    PRICE_ID_KEY,
} from "../utils/subscription";
import { createCheckoutSession, getCheckoutUrl } from "../utils/stripe";

enum CryptexAuthModalMode {
    SignIn = "signin",
    SignUp = "signup",
}

export type LoginProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const Login: NextPage<LoginProps> = ({ providers }) => {
    return null;

    // const queryString = useRouter();

    // const fromTierPurchase = queryString.query.checkout_plan;
    // const cryptexAuthModalMode: CryptexAuthModalMode | null = queryString.query
    //     .mode as CryptexAuthModalMode;
    // const email = queryString.query.email as string;

    // const cryptexAuthModal = useState(
    //     fromTierPurchase != null || cryptexAuthModalMode != null
    // );
    // const showCryptexAuthModal = () => cryptexAuthModal[1](true);

    // // If the error query parameter is set, display an error message in nextjs
    // const error = queryString.query.error;
    // if (error) {
    //     toast.error("Authentication failed. Please try again.", {
    //         toastId: "auth-error",
    //         onClose() {
    //             // Only show the console message once
    //             console.error(error);
    //             // Then remove the query parameter from the URL
    //             queryString.replace(queryString.pathname);
    //         },
    //     });
    // }

    // return (
    //     <>
    //         <HTMLHeader
    //             title="Cryptex Vault - Login"
    //             description="Log into your Cryptex Vault account using various Identity Providers."
    //         />

    //         <HTMLMain additionalClasses="flex flex-col">
    //             <NavBar></NavBar>
    //             <div className="content mb-20 flex grow flex-col justify-center">
    //                 <div className="flex flex-col items-center justify-center drop-shadow-lg">
    //                     <div className="card flex flex-col items-center rounded-lg border-2 p-4">
    //                         <h1 className="pb-7 pt-2 text-3xl">Sign In</h1>
    //                         <div className="flex flex-col items-center">
    //                             {Object.values(providers ?? [])
    //                                 .reverse()
    //                                 .map((provider) => {
    //                                     return (
    //                                         <div
    //                                             key={
    //                                                 provider.name + "-container"
    //                                             }
    //                                             className="flex flex-col items-center"
    //                                         >
    //                                             <SignInCard
    //                                                 key={provider.name}
    //                                                 serviceName={provider.name}
    //                                                 serviceLogo={provider.id}
    //                                                 serviceID={provider.id}
    //                                                 cryptexLoginModalTriggerFn={
    //                                                     showCryptexAuthModal
    //                                                 }
    //                                             />
    //                                             {provider.id !==
    //                                             "cryptex" ? null : (
    //                                                 <hr
    //                                                     key={
    //                                                         provider.name +
    //                                                         "-divider"
    //                                                     }
    //                                                     className="my-5 w-9/12 border-2 border-gray-700 bg-black"
    //                                                 />
    //                                             )}
    //                                         </div>
    //                                     );
    //                                 })}
    //                         </div>
    //                     </div>
    //                 </div>
    //             </div>
    //             <PageFooter></PageFooter>
    //         </HTMLMain>
    //         <LoginModal
    //             visibleState={cryptexAuthModal}
    //             formMode={FormMode.Any}
    //             userInitialMode={
    //                 fromTierPurchase ||
    //                 cryptexAuthModalMode === CryptexAuthModalMode.SignUp
    //                     ? FormMode.SignUp
    //                     : FormMode.SignIn
    //             }
    //             emailPrefill={email}
    //         />
    //         <NotificationContainer />
    //     </>
    // );
};

// type SignInCardProps = {
//     available?: boolean;
//     serviceName: string;
//     serviceID: string;
//     serviceLogo: string;
//     cryptexLoginModalTriggerFn?: () => void;
// };

// const SignInCard: React.FC<SignInCardProps> = ({
//     available = true,
//     serviceName,
//     serviceLogo,
//     serviceID,
//     cryptexLoginModalTriggerFn,
// }) => {
//     const isCryptexLogin = serviceID === "cryptex";
//     return (
//         <button
//             className={`my-2 inline-flex w-full items-center rounded border-black bg-gray-600 px-4 py-2 font-bold
//             transition-colors ${
//                 available ? "hover:bg-gray-500" : "opacity-50"
//             } ${available ? "cursor-pointer" : "cursor-default"} h-16`}
//             style={{ minWidth: 310 }}
//             disabled={!available}
//             onClick={() => {
//                 if (!isCryptexLogin) {
//                     signIn(serviceID);
//                 } else {
//                     if (cryptexLoginModalTriggerFn != null)
//                         cryptexLoginModalTriggerFn();
//                 }
//             }}
//         >
//             <div className="flex w-full flex-row items-center justify-between ">
//                 <div>
//                     <Image
//                         src={`/images/brand_images/${serviceLogo}.svg`}
//                         alt={serviceLogo}
//                         width={30}
//                         height={30}
//                     />
//                 </div>
//                 <div className="flex flex-col">
//                     <p className="text-gray-200">Using {serviceName}</p>
//                     {isCryptexLogin ? (
//                         <p className="text-gray-400">Recommended</p>
//                     ) : null}
//                 </div>
//                 {/* This empty element is needed so we can center the text */}
//                 <div></div>
//             </div>
//         </button>
//     );
// };

export const getServerSideProps = async (ctx: {
    req: NextApiRequest;
    res: NextApiResponse;
}) => {
    const session = await getServerAuthSession({ req: ctx.req, res: ctx.res });

    // If the user already has a session, redirect them
    if (session && session.user) {
        const url = ctx.req.url;

        if (url && url.includes("?")) {
            const query = url.split("?")[1];
            const params = new URLSearchParams(query);

            // if (params.has("link_device")) {
            //     const deviceToLink = params.get("link_device");
            //     if (deviceToLink) {
            //         return {
            //             redirect: {
            //                 destination: `/link_device?device=${deviceToLink}`,
            //                 permanent: false,
            //             },
            //         };
            //     }
            // }

            // If the user is coming from a tier purchase, we want to redirect them to the checkout page as soon
            // as they sign in
            if (params.has("checkout_plan") && session.user.email) {
                const checkoutPlan = params.get("checkout_plan");
                if (
                    checkoutPlan &&
                    PAYMENT_TIERS_LABELS.includes(checkoutPlan)
                ) {
                    const checkoutSession = await createCheckoutSession(
                        session.user.email,
                        session.user.id,
                        GetPriceID(checkoutPlan as PRICE_ID_KEY)
                    );

                    const checkoutUrl = await getCheckoutUrl(checkoutSession);

                    return {
                        redirect: {
                            destination: checkoutUrl,
                            permanent: false,
                        },
                    };
                }
            }

            // If the user is coming from the app, redirect them to the app page
            // if (params.has("from_app")) {
            //     return {
            //         redirect: {
            //             destination: "/app",
            //             permanent: false,
            //         },
            //     };
            // }
        }
    }

    return {
        redirect: {
            destination: "/app",
            permanent: false,
        },
    };
};

export default Login;
