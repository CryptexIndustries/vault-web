// import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import * as trpc from "@trpc/server";
import { randomUUID } from "crypto";
// import { User } from "next-auth";
import { z } from "zod";
import { env } from "../../../env/server.mjs";
// import { checkTOTP, encryptTOTPSecret } from "../../../utils/data_security";
import { createRouter } from "../context";
import { Redis } from "@upstash/redis";
import validateCaptcha from "../../../utils/captcha";
import {
    checkAuthRatelimit,
    checkRatelimitRegisterUser,
    trpcRatelimitError,
} from "../../common/ratelimiting";
import {
    confirmVerificationToken,
    createVerificationToken,
} from "../../common/identity-confirmation";

const redis = Redis.fromEnv();

export const credentialsRouter = createRouter()
    .query("generateAuthNonce", {
        output: z.string(),
        async resolve({ ctx }) {
            if (!checkAuthRatelimit(ctx.userIP)) {
                throw trpcRatelimitError;
            }

            // Use the crypto module to generate a nonce
            const nonce = randomUUID();

            try {
                // Save the nonce to the upstash redis cache
                const isProd = env.NODE_ENV === "production";
                if (isProd)
                    await redis.set(`auth-nonce-${nonce}`, "true", {
                        // Set the nonce to expire after 1 minute
                        ex: 60,
                    });
            } catch (e) {
                // If the nonce failed to save, log the error
                // This is not a critical error, so we don't throw an error
                // We just log the error and return the nonce
                console.error(
                    "[TRPC - credentials.generateAuthNonce] Failed to save nonce to redis.",
                    e
                );
            }

            return nonce;
        },
    })
    .mutation("register-user", {
        input: z.object({
            email: z.string().email(),
            publicKey: z.string().max(256, "Invalid public key"),
            captchaToken: z.string(),
        }),
        output: z.string(),
        async resolve({ ctx, input }) {
            if (!checkRatelimitRegisterUser(ctx.userIP)) {
                throw trpcRatelimitError;
            }

            // Send a request to the Captcha API to verify the user's response
            const verification = await validateCaptcha(input.captchaToken);

            // If the user's response was invalid, return an error
            if (!verification.success) {
                throw new Error("Failed to validate captcha");
            }

            // Check if the user already exists (by email)
            const existingUser = await ctx.prisma.user.findFirst({
                where: {
                    email: input.email,
                },
                select: {
                    id: true,
                },
            });

            // If the email is not unique, throw an error
            if (existingUser) {
                throw new trpc.TRPCError({
                    code: "BAD_REQUEST",
                    message: "The specified email is already registered",
                });
            }

            let userId: string;
            let accountId: string;
            try {
                // Create a new user
                const user = await ctx.prisma.user.create({
                    data: {
                        email: input.email,
                        name: input.email.split("@")[0],
                    },
                });

                // Create an account for this user
                const account = await ctx.prisma.account.create({
                    data: {
                        userId: user.id,
                        provider: "cryptex-key-based",
                        type: "credentials",
                        providerAccountId: randomUUID(),
                        public_key: input.publicKey,
                    },
                });

                userId = user.id;
                accountId = account.providerAccountId;
            } catch (e) {
                console.error(
                    "[TRPC - credentials.register-user] Failed to register user.",
                    e
                );
                throw new trpc.TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Something went wrong",
                });
            }

            // Create a new confirmation token
            const token = createVerificationToken(ctx.prisma, userId);

            // TODO: Generate a new confirmation link
            // TODO: Craft a confirmation email
            // TODO: Send the confirmation email

            return accountId;
        },
    })
    .mutation("confirm", {
        input: z.object({
            captchaToken: z.string(),
            token: z.string(),
        }),
        async resolve({ ctx, input }) {
            // TODO: Add rate limiting

            // throw new Error("Working on it");

            // Send a request to the Captcha API to verify the user's response
            const verification = await validateCaptcha(input.captchaToken);

            // If the user's response was invalid, return an error
            if (!verification.success) {
                throw new Error("Failed to validate captcha");
            }

            // Check if the token that the user provided is valid
            const isTokenValid = await confirmVerificationToken(
                ctx.prisma,
                input.token
            );

            // If the token is invalid, throw an error
            if (!isTokenValid) {
                throw new trpc.TRPCError({
                    code: "BAD_REQUEST",
                    message: "Invalid token",
                });
            }
        },
    });
// .mutation("register-user-legacy", {
//     input: z.object({
//         email: z.string().email().trim(),
//         secret: z.string().trim().max(100, "Secret is too long"),
//         token: z.string().trim().max(100, "Token is too long"),
//     }),
//     async resolve({ ctx, input }) {
//         try {
//             // Check if the token that the user provided is valid
//             const isTokenValid = await checkTOTP(input.token, input.secret);

//             // If the token is invalid, throw an error
//             if (!isTokenValid) {
//                 throw new trpc.TRPCError({
//                     code: "BAD_REQUEST",
//                     message: "Invalid token",
//                 });
//             }

//             const existingSession =
//                 ctx.session != null && ctx.session.user != null;

//             let userID = "";

//             if (!existingSession) {
//                 // Check if the user already exists (by email)
//                 const existingUser = await ctx.prisma.user.findFirst({
//                     where: {
//                         email: input.email,
//                     },
//                     select: {
//                         id: true,
//                     },
//                 });

//                 // If the user already exists, throw an error
//                 if (existingUser) {
//                     throw new trpc.TRPCError({
//                         code: "BAD_REQUEST",
//                         message: "User already exists",
//                     });
//                 }

//                 // If the user has no session (i.e. they are not logged in) and the email is unique, create a new user
//                 const user = await ctx.prisma.user.create({
//                     data: {
//                         email: input.email,
//                         name: input.email.split("@")[0],
//                     },
//                 });

//                 // Set the user ID to the newly created user's ID
//                 userID = user.id;
//             } else if (ctx.session && ctx.session.user) {
//                 // If the user already has a session and the account is already created, throw an error
//                 const account = await ctx.prisma.account.findFirst({
//                     where: {
//                         userId: ctx.session.user.id,
//                         provider: "cryptex",
//                     },
//                     select: {
//                         id: true,
//                     },
//                 });

//                 // If the account already exists, throw an error
//                 if (account) {
//                     throw new trpc.TRPCError({
//                         code: "BAD_REQUEST",
//                         message: "Account already linked",
//                     });
//                 }

//                 // Set the user ID to the user's ID taken from the session
//                 userID = ctx.session.user.id;
//             }

//             // Create an account for this user
//             const userObj: { user: User | null } =
//                 await ctx.prisma.account.create({
//                     data: {
//                         userId: userID,
//                         provider: "cryptex",
//                         type: "credentials",
//                         providerAccountId: randomUUID(),
//                         totp_secret: await encryptTOTPSecret(
//                             input.secret,
//                             env.NEXTAUTH_SECRET
//                         ),
//                     },
//                     select: {
//                         user: true,
//                     },
//                 });

//             return userObj?.user?.email;
//         } catch (e) {
//             if (e instanceof PrismaClientKnownRequestError) {
//                 if (e.code === "P2002") {
//                     throw new trpc.TRPCError({
//                         code: "CONFLICT",
//                         message: "User already exists",
//                     });
//                 }
//             }
//             if (e instanceof trpc.TRPCError && e.code === "BAD_REQUEST") {
//                 throw e;
//             } else {
//                 console.error("Failed to register user");
//                 console.error(e);
//                 throw new trpc.TRPCError({
//                     code: "INTERNAL_SERVER_ERROR",
//                     message: "Something went wrong",
//                 });
//             }
//         }
//     },
// });
