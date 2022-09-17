import NextAuth, {
    Awaitable,
    RequestInternal,
    User,
    type NextAuthOptions,
} from "next-auth";

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

export const authOptions: NextAuthOptions = {
    // Include user.id on session
    callbacks: {
        session({ session, user }) {
            if (session.user) {
                session.user.id = user.id;
            }
            return session;
        },
    },
    secret: env.NEXTAUTH_SECRET,
    session: {
        strategy: "database",
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },
    // Configure one or more authentication providers
    adapter: PrismaAdapter(prisma),
    pages: {
        signIn: "/login",
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
            id: "cryptex",
            name: "Cryptex Authentication",
            credentials: {
                email: {
                    label: "Username",
                    type: "text ",
                    placeholder: "jsmith",
                },
                "2fa-key": { label: "2FA Key" },
            },
            authorize: function (
                credentials:
                    | Record<string | number | symbol, string>
                    | undefined,
                req: Pick<
                    RequestInternal,
                    "query" | "headers" | "body" | "method"
                >
            ): Awaitable<
                Omit<User, "id"> | { id?: string | undefined } | null
            > {
                // throw new Error("Function not implemented.");
                const user = {
                    /* add function to get user */
                };
                return user;
            },
        }),
    ],
};

export default NextAuth(authOptions);
