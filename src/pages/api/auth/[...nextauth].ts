import NextAuth, { DefaultSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { NextApiRequest, NextApiResponse } from "next";
// import { randomUUID } from "crypto";
// import { getCookie, setCookie } from "cookies-next";
// import { decode, encode } from "next-auth/jwt";
import { Redis } from "@upstash/redis";
import { prisma } from "../../../server/db/client";
import { env } from "../../../env/server.mjs";
import { validateSignature } from "../../../utils/data_security";
import { initUserSubscriptionTier } from "../../../utils/subscription";
import validateCaptcha from "../../../utils/captcha";
import { checkAuthRatelimit } from "../../../server/common/ratelimiting";

// Used for nonce generation and verification
const redis = Redis.fromEnv();

export const handler = async (req: NextApiRequest, res: NextApiResponse) => {
    const data = requestWrapper(req, res);
    return await NextAuth(...data);
};

export default handler;

//#region Available Auth Providers
export enum CREDENTIAL_PROVIDERS {
    CryptexKeyBased = "cryptex-key-based",
}
export const AvailableAuthProvidersList = ["cryptex-key-based"] as const;
export type AvailableAuthProviders = "cryptex-key-based";
//#endregion

// Extend the built-in session type
declare module "next-auth" {
    interface Session {
        user?: {
            id: string;
            // accountId?: string;
            agent?: string;
            confirmed: Date | null;
        } & DefaultSession["user"];
    }
}

// Extend the built-in token type
// declare module "next-auth/jwt" {
//     interface JWT {
//         accountId?: string;
//     }
// }

export function requestWrapper(
    req: NextApiRequest,
    res: NextApiResponse
): [req: NextApiRequest, res: NextApiResponse, opts: NextAuthOptions] {
    // const generateSessionToken = () => randomUUID();

    const defaultSessionExpiery = 60 * 60 * 24 * 1; // 1 day
    // const defaultSessionTokenName = "auth.session-token";

    // const fromDate = (time: number, date = Date.now()) =>
    //     new Date(date + time * 1000);

    const adapter = PrismaAdapter(prisma);

    const opts: NextAuthOptions = {
        adapter: adapter,
        callbacks: {
            async session({ session, token }) {
                // console.log("SESS", session);
                // console.log("token", token);
                // console.log("USER", user);
                if (session.user && token.sub) {
                    // console.log("SESS", session);
                    // console.log("TOKEN", token);
                    // Include user.id and user.agent in the session object
                    session.user.id = token.sub;
                    // session.user.accountId = token.accountId;
                    session.user.agent = req.headers["user-agent"];

                    const confirmed =
                        (
                            await prisma.user.findUnique({
                                where: {
                                    id: token.sub,
                                },
                                select: {
                                    email_verified_at: true,
                                },
                            })
                        )?.email_verified_at ?? null;

                    session.user.confirmed = confirmed;
                }
                return session;
            },
            // jwt: async ({ token, user, account, profile, isNewUser }) => {
            //     // if (user) {
            //     //     token.id = user.id;
            //     // }
            //     if (account) {
            //         console.log("JWT ACCOUNT", account);
            //         token.accountId = account.id_token;
            //     }
            //     return token;
            // },
            async signIn({ user }) {
                // Check if this sign in callback is being called in the credentials authentication flow
                // If so, use the next-auth adapter to create a session entry in the database (SignIn is called after authorize so we can safely assume the user is valid and already authenticated)
                // if (
                //     req.query.nextauth?.includes("callback") &&
                //     (req.query.nextauth?.includes(
                //         CREDENTIAL_PROVIDERS.CryptexTOTP
                //     ) ||
                //         req.query.nextauth?.includes(
                //             CREDENTIAL_PROVIDERS.CryptexKeyBased
                //         )) &&
                //     req.method === "POST"
                // ) {
                //     if (user) {
                //         const sessionToken = generateSessionToken();
                //         const sessionExpiry = fromDate(
                //             opts.session?.maxAge ?? defaultSessionExpiery
                //         );

                //         const newSession = await adapter.createSession({
                //             sessionToken: sessionToken,
                //             userId: user.id,
                //             expires: sessionExpiry,
                //         });

                //         // Or x-vercel-forwarded-for?
                //         const forwarded = req.headers[
                //             "x-forwarded-for"
                //         ] as string;
                //         const ip = forwarded
                //             ? forwarded.split(/, /)[0]
                //             : req.socket.remoteAddress;

                //         // Set the user agent field in the current session
                //         await prisma.session.update({
                //             data: {
                //                 user_agent: req.headers["user-agent"],
                //                 ip: ip,
                //             },
                //             where: {
                //                 sessionToken: newSession.sessionToken,
                //             },
                //         });

                //         setCookie(
                //             opts.cookies?.sessionToken?.name ??
                //                 defaultSessionTokenName,
                //             sessionToken,
                //             { ...opts.cookies?.sessionToken?.options, req, res }
                //         );
                //     }
                // }

                // Check whether or not a subscription exists for the user, if it doesn't then create one for the free plan
                if (user.email)
                    initUserSubscriptionTier(prisma, user.id, user.email);

                return true;
            },
        },
        // jwt: {
        //     encode: async ({ token, secret, maxAge }) => {
        //         if (
        //             req.query.nextauth?.includes("callback") &&
        //             (req.query.nextauth.includes(
        //                 CREDENTIAL_PROVIDERS.CryptexTOTP
        //             ) ||
        //                 req.query.nextauth.includes(
        //                     CREDENTIAL_PROVIDERS.CryptexKeyBased
        //                 )) &&
        //             req.method === "POST"
        //         ) {
        //             const cookie = getCookie(
        //                 opts.cookies?.sessionToken?.name ??
        //                     defaultSessionTokenName
        //             )?.toString();

        //             if (cookie) return cookie;
        //             else return "";
        //         }

        //         // Revert to default behaviour when not in the credentials provider callback flow
        //         return encode({ token, secret, maxAge });
        //     },
        //     decode: async ({ token, secret }) => {
        //         if (
        //             req.query.nextauth?.includes("callback") &&
        //             (req.query.nextauth.includes(
        //                 CREDENTIAL_PROVIDERS.CryptexTOTP
        //             ) ||
        //                 req.query.nextauth.includes(
        //                     CREDENTIAL_PROVIDERS.CryptexKeyBased
        //                 )) &&
        //             req.method === "POST"
        //         ) {
        //             // Skip the jwt verification for the Cryptex Vault credentials provider
        //             return null;
        //         }

        //         // Revert to default behaviour when not in the credentials provider callback flow
        //         return decode({ token, secret });
        //     },
        // },
        session: {
            // strategy: "database",
            strategy: "jwt",
            maxAge: defaultSessionExpiery,
            updateAge: 24 * 60 * 60, // 24 hours
        },
        theme: {
            colorScheme: "dark",
            brandColor: "#FF5668",
        },
        pages: {
            signIn: "/app",
            error: "",
            verifyRequest: "/confirm",
            newUser: "",
        },
        cookies: {
            sessionToken: {
                name: `auth.session-token`,
                options: {
                    httpOnly: true,
                    sameSite: "lax",
                    path: "/",
                    secure: process.env.NODE_ENV !== "development",
                },
            },
        },
        secret: env.NEXTAUTH_SECRET,
        providers: [
            // CredentialsProvider({
            //     id: CREDENTIAL_PROVIDERS.CryptexTOTP,
            //     name: "Cryptex Auth",
            //     credentials: {
            //         email: {
            //             label: "Email",
            //             name: "email",
            //             type: "text",
            //         },
            //         token: {
            //             label: "Token",
            //             name: "token",
            //             type: "text",
            //         },
            //     },
            //     authorize: async (
            //         credentials:
            //             | Record<string | number | symbol, string>
            //             | undefined
            //     ) => {
            //         // Validate data format
            //         if (!credentials?.email || !credentials?.token) {
            //             return null;
            //         }

            //         // Use prisma to check if user exists by email
            //         // If user exists, return user object
            //         // If user does not exist, return null
            //         const user = await prisma.user.findUnique({
            //             where: {
            //                 email: credentials.email,
            //             },
            //         });

            //         if (user) {
            //             const account = await prisma.account.findFirst({
            //                 where: {
            //                     userId: user.id,
            //                     provider: CREDENTIAL_PROVIDERS.CryptexTOTP,
            //                 },
            //                 select: {
            //                     totp_secret: true,
            //                 },
            //             });

            //             // If account does not exist, return false
            //             if (!account || account.totp_secret == null)
            //                 return null;

            //             // If account exists, return user object
            //             if (
            //                 await checkTOTP(
            //                     credentials.token,
            //                     account.totp_secret,
            //                     env.NEXTAUTH_SECRET
            //                 )
            //             ) {
            //                 return user;
            //             }
            //         }

            //         return null;
            //     },
            // }),

            CredentialsProvider({
                id: CREDENTIAL_PROVIDERS.CryptexKeyBased,
                name: "Cryptex Key Based Auth",
                credentials: {
                    userID: {
                        label: "User ID",
                        name: "userID",
                        type: "text",
                    },
                    nonce: {
                        label: "Nonce",
                        name: "nonce",
                        type: "text",
                    },
                    signature: {
                        label: "Signature",
                        name: "signature",
                        type: "text",
                    },
                    captchaToken: {
                        label: "Captcha Token",
                        name: "captchaToken",
                        type: "text",
                    },
                },
                authorize: async (
                    credentials:
                        | Record<string | number | symbol, string>
                        | undefined,
                    req
                ) => {
                    // Get the ip address of the request
                    const ip: string =
                        req.headers?.["x-forwarded-for"] ?? "127.0.0.1";

                    if (!checkAuthRatelimit(ip)) {
                        return null;
                    }

                    if (
                        !credentials?.userID ||
                        !credentials?.nonce ||
                        !credentials?.signature
                    ) {
                        // Validate data format
                        return null;
                    }

                    // Validate captcha token
                    if (env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA) {
                        if (!credentials?.captchaToken) return null;

                        const response = await validateCaptcha(
                            credentials.captchaToken
                        );

                        if (!response.success) return null;
                    }

                    // Check if there is an account with the provided userID
                    const account = await prisma.account.findFirst({
                        where: {
                            providerAccountId: credentials.userID,
                            provider: CREDENTIAL_PROVIDERS.CryptexKeyBased,
                        },
                        select: {
                            public_key: true,
                            userId: true,
                        },
                    });

                    // If account does not exist, return false
                    if (
                        !account ||
                        !account.public_key ||
                        !account.public_key.length
                    )
                        return null;

                    // If account exists, check if nonce exists in the redis cache (validate it)
                    const isProd = env.NODE_ENV === "production";
                    const nonce = isProd
                        ? await redis.get<string>(
                              `auth-nonce-${credentials.nonce}`
                          )
                        : null;

                    // If the nonce is not valid, return false
                    if (!nonce && isProd) return null;

                    // Remove the nonce from the redis cache
                    if (isProd)
                        await redis.del(
                            `auth-nonce-${credentials.signedNonce}`
                        );

                    // Verify the nonce signature
                    // If the signature is not valid, return false
                    // If the signature is valid, return the user object
                    const signatureValid = await validateSignature(
                        credentials.signature,
                        account.public_key
                    );

                    if (!signatureValid) return null;

                    const user = await prisma.user.findUnique({
                        where: {
                            id: account.userId,
                        },
                    });

                    if (!user) return null;

                    // Check if the user has confirmed their email
                    if (!user.email_verified_at) {
                        // Check if the verification expiry has passed
                        if (user.email_verification_expires_at < new Date()) {
                            // If it the expiry has passed, disable the account
                            throw new Error(
                                "Your email verification period has expired and the account has been disabled. Please contact support to re-enable your account."
                            );
                        }
                    }

                    // If the signature is valid, return the user object
                    return user;
                },
            }),
        ],
    };

    return [req, res, opts];
}
