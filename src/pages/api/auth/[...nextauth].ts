import NextAuth, {
    DefaultSession,
    DefaultUser,
    type NextAuthOptions,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getCookie, setCookie } from "cookies-next";
import { decode, encode } from "next-auth/jwt";
import { Redis } from "@upstash/redis";
import { prisma } from "../../../server/db/client";
import { env } from "../../../env/server.mjs";
import { validateSignature } from "../../../utils/data_security";
import { initUserSubscriptionTier } from "../../../utils/subscription";
import validateCaptcha from "../../../utils/captcha";
import { checkAuthRatelimit } from "../../../server/common/ratelimiting";
import { PrismaAdapter } from "../../../server/common/prisma-adapter";

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
    interface Session extends DefaultSession {
        user?: {
            id: string;
            accountID: string;
            confirmed_at: Date | null;
            confirmation_period_expires_at: Date | null;
            email: string;
            image: never;
            isRoot: boolean;
        } & DefaultSession["user"];
    }

    interface User extends DefaultUser {
        // This accountID is smuggled in during the authorization callback (within the CredentialsProvider)
        accountID: string;
        isRoot: boolean;
        email_verified_at: Date | null;
        email_verification_expires_at: Date | null;
    }
}

export function requestWrapper(
    req: NextApiRequest,
    res: NextApiResponse
): [req: NextApiRequest, res: NextApiResponse, opts: NextAuthOptions] {
    const generateSessionToken = () => randomUUID();

    const defaultSessionExpiery = 60 * 60 * 24 * 1; // 1 day
    const sessionTokenName = "auth.session-token";

    const fromDate = (time: number, date = Date.now()) =>
        new Date(date + time * 1000);

    const adapter = PrismaAdapter(prisma);

    const opts: NextAuthOptions = {
        adapter: adapter,
        session: {
            // strategy: "database",
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
                name: sessionTokenName,
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
                            providerAccountId: credentials.userID, // This is actually not the userID but the provider account ID
                            provider: CREDENTIAL_PROVIDERS.CryptexKeyBased,
                        },
                        select: {
                            id: true,
                            public_key: true,
                            userId: true,
                            root: true,
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
                    // For dx reasons, we don't want to check this in dev
                    if (
                        !user.email_verified_at &&
                        env.NODE_ENV === "production"
                    ) {
                        // Check if the verification expiry has passed
                        if (user.email_verification_expires_at < new Date()) {
                            // If it the expiry has passed, disable the account
                            throw new Error(
                                "Your email verification period has expired and the account has been disabled. Please contact support to re-enable your account."
                            );
                        }
                    }

                    // If the signature is valid, return the user object
                    // An ugly hack to get the accountID into the User object
                    // This is required so we can control the logins per account
                    return {
                        ...user,
                        accountID: account.id,
                        isRoot: account.root, // This is not actually used in the signIn flow, it's there to make the type system happy
                    };
                },
            }),
        ],
        jwt: {
            encode: async ({ token, secret, maxAge }) => {
                if (
                    req.query.nextauth?.includes("callback") &&
                    req.query.nextauth.includes(
                        CREDENTIAL_PROVIDERS.CryptexKeyBased
                    ) &&
                    req.method === "POST"
                ) {
                    const cookie = getCookie(
                        opts.cookies?.sessionToken?.name ?? sessionTokenName
                    )?.toString();

                    if (cookie) return cookie;
                    else return "";
                }

                // Revert to default behaviour when not in the credentials provider callback flow
                return encode({ token, secret, maxAge });
            },
            decode: async ({ token, secret }) => {
                if (
                    req.query.nextauth?.includes("callback") &&
                    req.query.nextauth.includes(
                        CREDENTIAL_PROVIDERS.CryptexKeyBased
                    ) &&
                    req.method === "POST"
                ) {
                    // Skip the jwt verification for the Cryptex Vault credentials provider
                    return null;
                }

                // Revert to default behaviour when not in the credentials provider callback flow
                return decode({ token, secret });
            },
        },
        callbacks: {
            async session({ session, user }) {
                if (session.user && user.id) {
                    // Include these in the session object
                    session.user.id = user.id;
                    session.user.accountID = user.accountID;
                    session.user.isRoot = user.isRoot;
                    session.user.confirmed_at = user.email_verified_at;
                    session.user.confirmation_period_expires_at =
                        user.email_verification_expires_at;
                }
                return session;
            },
            async signIn({ user }) {
                // Check if this sign in callback is being called in the credentials authentication flow
                // If so, use the next-auth adapter to create a session entry in the database (SignIn is called after authorize so we can safely assume the user is valid and already authenticated)
                if (
                    req.query.nextauth?.includes("callback") &&
                    req.query.nextauth?.includes(
                        CREDENTIAL_PROVIDERS.CryptexKeyBased
                    ) &&
                    req.method === "POST"
                ) {
                    if (user) {
                        const sessionToken = generateSessionToken();
                        const sessionExpiry = fromDate(
                            opts.session?.maxAge ?? defaultSessionExpiery
                        );

                        // Or x-vercel-forwarded-for?
                        const forwarded = req.headers[
                            "x-forwarded-for"
                        ] as string;
                        const ip = forwarded
                            ? forwarded.split(/, /)[0]
                            : req.socket.remoteAddress;

                        try {
                            // Making this an upsert means that if the user already has a session, it will be updated with the new session token and expiry
                            // The user will only ever have one session at a time - the old one will be invalidated
                            // Use the smuggled accountID from the hacked User object from the credentials provider authorize callback
                            await prisma.session.upsert({
                                create: {
                                    userId: user.id,
                                    account_id: user.accountID,
                                    sessionToken: sessionToken,
                                    expires: sessionExpiry,
                                    user_agent: req.headers["user-agent"],
                                    ip: ip,
                                },
                                update: {
                                    userId: user.id,
                                    sessionToken: sessionToken,
                                    expires: sessionExpiry,
                                    user_agent: req.headers["user-agent"],
                                    ip: ip,
                                },
                                where: {
                                    account_id: user.accountID,
                                },
                            });
                        } catch (err) {
                            console.error(
                                "[NextAuth] Failed to create session.",
                                err
                            );
                            throw new Error("Failed to create session");
                        }

                        setCookie(
                            opts.cookies?.sessionToken?.name ??
                                sessionTokenName,
                            sessionToken,
                            { ...opts.cookies?.sessionToken?.options, req, res }
                        );

                        // Check whether or not a subscription exists for the user, if it doesn't then create one for the free plan
                        if (user.email)
                            initUserSubscriptionTier(
                                prisma,
                                user.id,
                                user.email
                            );

                        return true;
                    }
                }

                return false;
            },
        },
    };

    return [req, res, opts];
}
