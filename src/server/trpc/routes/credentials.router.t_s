import { PrismaClientKnownRequestError } from "@prisma/client/runtime";
import * as trpc from "@trpc/server";
import { randomUUID } from "crypto";
import { User } from "next-auth";
import { env } from "../../../env/server.mjs";
import type { CreateUserSchema } from "../../../schemes/user.schema";
import { createUserSchema } from "../../../schemes/user.schema";
import { checkTOTP, encryptTOTPSecret } from "../../../utils/data_security";
import { createRouter } from "../context";

export const credentialsRouter = createRouter().mutation("register-user", {
    input: createUserSchema,
    async resolve({ ctx, input }) {
        const inputData: CreateUserSchema = input;

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

            const existingSession =
                ctx.session != null && ctx.session.user != null;

            let userID = "";

            if (!existingSession) {
                // If the user has no session (i.e. they are not logged in), create a new user
                const user = await ctx.prisma.user.create({
                    data: {
                        email: inputData.email,
                        name: inputData.email.split("@")[0],
                    },
                });

                // Set the user ID to the newly created user's ID
                userID = user.id;
            } else if (ctx.session && ctx.session.user) {
                // If the user already has a session and the account is already created, throw an error
                const account = await ctx.prisma.account.findFirst({
                    where: {
                        userId: ctx.session.user.id,
                        provider: "cryptex",
                    },
                    select: {
                        id: true,
                    },
                });

                // If the account already exists, throw an error
                if (account) {
                    throw new trpc.TRPCError({
                        code: "BAD_REQUEST",
                        message: "Account already linked",
                    });
                }

                // Set the user ID to the user's ID taken from the session
                userID = ctx.session.user.id;
            }

            // Create an account for this user
            const userObj: { user: User | null } =
                await ctx.prisma.account.create({
                    data: {
                        userId: userID,
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
