import NextAuth, { type NextAuthOptions } from "next-auth";

import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import GithubProvider from "next-auth/providers/github";
import GitlabProvider from "next-auth/providers/gitlab";
// import DiscordProvider from "next-auth/providers/discord";
import CredentialsProvider from "next-auth/providers/credentials";

// Prisma adapter for NextAuth, optional and can be removed
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "../../../server/db/client";
import { env } from "../../../env/server.mjs";
import { checkTOTP } from "../../../utils/data_security";

export enum CREDENTIAL_PROVIDERS {
    CryptexTOTP = "cryptex",
}

export const authOptions: NextAuthOptions = {
    // Include user.id on session
    callbacks: {
        async session({ session }) {
            if (session && session.user != null && session.user.email != null) {
                // Fetch user from database by email
                const user = await prisma.user.findUnique({
                    where: {
                        email: session.user.email,
                    },
                });

                if (user) {
                    session.user.id = user.id;
                }
            }
            return session;
        },
    },
    secret: env.NEXTAUTH_SECRET,
    session: {
        // strategy: "database",
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30 days
        updateAge: 24 * 60 * 60, // 24 hours
    },
    // Configure one or more authentication providers
    adapter: PrismaAdapter(prisma),
    pages: {
        // signIn: "/login",
    },
    jwt: {
        // secret: env.NEXTAUTH_SECRET,
        maxAge: 30 * 24 * 60 * 60, // 30 days
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
                    if (!account) return null;
                    // If account exists, return user object
                    if (
                        await checkTOTP(
                            credentials.token,
                            account.totp_secret!,
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

export default NextAuth(authOptions);
