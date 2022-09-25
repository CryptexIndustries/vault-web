import { PrismaClientKnownRequestError } from "@prisma/client/runtime";
import * as trpc from "@trpc/server";
import { randomUUID } from "crypto";
import { User } from "next-auth";
import { signIn } from "next-auth/react/index.js";
import { z } from "zod";
import { env } from "../../../env/server.mjs";
import { createUserSchema } from "../../../schemes/user.schema";
import { checkTOTP, encryptTOTPSecret } from "../../../utils/data_security";
import { createRouter } from "../context";

export const credentialsRouter = createRouter().mutation("register-user", {
    input: createUserSchema,
    async resolve({ ctx, input }) {
        const inputData: z.TypeOf<typeof createUserSchema> = input;

        try {
            // Check if the token that the user provided is valid
            const isTokenValid = await checkTOTP(
                inputData.token,
                inputData.secret
            );

            // If the token is invalid, throw an error
            if (!isTokenValid) {
                throw new trpc.TRPCError({
                    code: "BAD_REQUEST",
                    message: "Invalid token",
                });
            }

            let user: User | null = null;
            // If the user has no session (i.e. they are not logged in), create a new user
            if (!ctx.session) {
                // Create the user
                user = await ctx.prisma.user.create({
                    data: {
                        email: inputData.email,
                        name: inputData.email.split("@")[0],
                    },
                });
            }

            // If the user already has a session and the account is already created, throw an error
            if (ctx.session && ctx.session?.user?.id) {
                const account = await ctx.prisma.account.findFirst({
                    where: {
                        userId: ctx.session.user.id,
                        provider: "cryptex",
                    },
                    select: {
                        id: true,
                    },
                });
                if (account) {
                    throw new trpc.TRPCError({
                        code: "BAD_REQUEST",
                        message: "Account already linked",
                    });
                }
            }

            // Create an account for this user
            const userObj: { user: User | null } =
                await ctx.prisma.account.create({
                    data: {
                        userId:
                            ctx.session && ctx.session?.user?.id
                                ? ctx.session.user.id
                                : user!.id,
                        provider: "cryptex",
                        type: "credentials",
                        providerAccountId: randomUUID(),
                        totp_secret: await encryptTOTPSecret(
                            inputData.secret,
                            env.NEXTAUTH_SECRET
                        ),
                    },
                    select: {
                        user: true,
                    },
                });

            return userObj?.user?.email;
        } catch (e) {
            if (e instanceof PrismaClientKnownRequestError) {
                if (e.code === "P2002") {
                    throw new trpc.TRPCError({
                        code: "CONFLICT",
                        message: "User already exists",
                    });
                }
            }
            if (e instanceof trpc.TRPCError && e.code === "BAD_REQUEST") {
                throw e;
            } else {
                console.error("Failed to register user");
                console.error(e);
                throw new trpc.TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Something went wrong",
                });
            }
        }
    },
});
