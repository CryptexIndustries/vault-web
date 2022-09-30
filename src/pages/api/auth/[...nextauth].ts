import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GithubProvider from "next-auth/providers/github";
import GitlabProvider from "next-auth/providers/gitlab";
import CredentialsProvider from "next-auth/providers/credentials";

import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "../../../server/db/client";
import { env } from "../../../env/server.mjs";
import { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getCookie, setCookie } from "cookies-next";
import { decode, encode } from "next-auth/jwt";
import { checkTOTP } from "../../../utils/data_security";

export enum CREDENTIAL_PROVIDERS {
    CryptexTOTP = "cryptex",
}

export const handler = async (req: NextApiRequest, res: NextApiResponse) => {
    const data = requestWrapper(req, res);
    return await NextAuth(...data);
};

export default handler;

export function requestWrapper(
    req: NextApiRequest,
    res: NextApiResponse
): [req: NextApiRequest, res: NextApiResponse, opts: NextAuthOptions] {
    const generateSessionToken = () => randomUUID();

    const defaultSessionExpiery = 60 * 60 * 24 * 30; // 30 days
    const defaultSessionTokenName = "auth.session-token";

    const fromDate = (time: number, date = Date.now()) =>
        new Date(date + time * 1000);

    const adapter = PrismaAdapter(prisma);

    const opts: NextAuthOptions = {
        // Include user.id on session
        adapter: adapter,
        callbacks: {
            session({ session, user }) {
                if (session.user) {
                    session.user.id = user.id;
                }
                return session;
            },
            async signIn({ user }) {
                // Check if this sign in callback is being called in the credentials authentication flow
                // If so, use the next-auth adapter to create a session entry in the database (SignIn is called after authorize so we can safely assume the user is valid and already authenticated)
                if (
                    req.query.nextauth?.includes("callback") &&
                    req.query.nextauth?.includes("cryptex") &&
                    req.method === "POST"
                ) {
                    if (user) {
                        const sessionToken = generateSessionToken();
                        const sessionExpiry = fromDate(
                            opts.session?.maxAge ?? defaultSessionExpiery
                        );

                        await adapter.createSession({
                            sessionToken: sessionToken,
                            userId: user.id,
                            expires: sessionExpiry,
                        });

                        setCookie(
                            opts.cookies?.sessionToken?.name ??
                                defaultSessionTokenName,
                            sessionToken,
                            { ...opts.cookies?.sessionToken?.options, req, res }
                        );
                    }
                }

                return true;
            },
        },
        jwt: {
            encode: async ({ token, secret, maxAge }) => {
                if (
                    req.query.nextauth?.includes("callback") &&
                    req.query.nextauth.includes("cryptex") &&
                    req.method === "POST"
                ) {
                    const cookie = getCookie(
                        opts.cookies?.sessionToken?.name ??
                            defaultSessionTokenName
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
                    req.query.nextauth.includes("cryptex") &&
                    req.method === "POST"
                ) {
                    return null;
                }

                // Revert to default behaviour when not in the credentials provider callback flow
                return decode({ token, secret });
            },
        },
        session: {
            // strategy: "database",
            maxAge: defaultSessionExpiery,
            updateAge: 24 * 60 * 60, // 24 hours
        },
        pages: {
            signIn: "/login",
            error: "",
            verifyRequest: "",
            newUser: "",
        },
        cookies: {
            sessionToken: {
                name: `auth.session-token`,
                options: {
                    httpOnly: true,
                    sameSite: "lax",
                    path: "/",
                    secure: true,
                },
            },
        },
        secret: env.NEXTAUTH_SECRET,
        providers: [
            GoogleProvider({
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
            }),
            // AppleProvider({
            //     clientId: env.APPLE_CLIENT_ID,
            //     clientSecret: env.APPLE_CLIENT_SECRET,
            // }),
            GithubProvider({
                clientId: env.GITHUB_CLIENT_ID,
                clientSecret: env.GITHUB_CLIENT_SECRET,
            }),
            GitlabProvider({
                clientId: env.GITLAB_CLIENT_ID,
                clientSecret: env.GITLAB_CLIENT_SECRET,
            }),
            CredentialsProvider({
                id: CREDENTIAL_PROVIDERS.CryptexTOTP,
                name: "Cryptex Auth",
                credentials: {
                    email: {
                        label: "Email",
                        name: "email",
                        type: "text",
                    },
                    token: {
                        label: "Token",
                        name: "token",
                        type: "text",
                    },
                },
                authorize: async (
                    credentials:
                        | Record<string | number | symbol, string>
                        | undefined
                ) => {
                    // Validate data format
                    if (!credentials?.email || !credentials?.token) {
                        return null;
                    }

                    // Use prisma to check if user exists by email
                    // If user exists, return user object
                    // If user does not exist, return null
                    const user = await prisma.user.findUnique({
                        where: {
                            email: credentials.email,
                        },
                    });

                    if (user) {
                        const account = await prisma.account.findFirst({
                            where: {
                                userId: user.id,
                                provider: CREDENTIAL_PROVIDERS.CryptexTOTP,
                            },
                            select: {
                                totp_secret: true,
                            },
                        });

                        // If account does not exist, return false
                        if (!account || account.totp_secret == null)
                            return null;

                        // If account exists, return user object
                        if (
                            await checkTOTP(
                                credentials.token,
                                account.totp_secret,
                                env.NEXTAUTH_SECRET
                            )
                        ) {
                            return user;
                        }
                    }

                    return null;
                },
            }),
        ],
    };

    return [req, res, opts];
}
