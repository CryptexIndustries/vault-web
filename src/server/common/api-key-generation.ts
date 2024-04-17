import argon2 from "argon2";
import { Context } from "../trpc/context";
import { randomUUID } from "crypto";

export enum APIKeyPurpose {
    Web = "web",
    Mobile = "mobile",
    Browser = "browser",
    CLI = "cli",
}

// NOTE: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id
const userAPIKeyArgon2Config: argon2.Options & { raw?: false } = {
    type: argon2.argon2id,
    parallelism: 1, // 1 threads (each thread has a memory pool of memoryCost bytes)
    memoryCost: 47104, // 46MiB
    timeCost: 2, // 2 iterations (2 pass over the memory)
    // salt: ..., // NOTE: We don't need to provide a salt, argon2 will generate a random salt
};

/**
 * Inserts the default API Key for the user into the database.
 * @default The default purpose of the API Key is "web"
 * @param ctx The TRPC context
 * @param userId The user ID for which to insert the default API Key
 * @returns The API Key and the API Key ID in one string
 */
export const insertDefaultAPIKey = async (
    ctx: Context,
    userId: string,
    root = true,
    purpose: APIKeyPurpose = APIKeyPurpose.Web,
) => {
    const generatedAPIKey = randomUUID();
    const hashedAPIKey = await argon2.hash(
        generatedAPIKey,
        userAPIKeyArgon2Config,
    );

    // Insert the API Key into the database
    const apiKey = await ctx.prisma.aPIKey.create({
        data: {
            key: hashedAPIKey,
            purpose,
            user_id: userId,
            root,
        },
    });

    return generatedAPIKey + apiKey.id;
};
