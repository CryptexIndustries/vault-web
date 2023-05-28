import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

enum TokenExpiration {
    ONE_DAY = 1000 * 60 * 60 * 24,
    ONE_WEEK = 1000 * 60 * 60 * 24 * 7,
}

const TOKEN_EXPIRATION = TokenExpiration.ONE_DAY;

const generateToken = (): string => {
    // Genereate a random token from 3 random UUIDs contatenated with a '-'
    return [randomUUID(), randomUUID(), randomUUID()].join("-");
};

export const createVerificationToken = async (
    prismaInstance: PrismaClient,
    userId: string
) => {
    const token = generateToken();

    await prismaInstance.verificationToken.upsert({
        where: {
            user_id: userId,
        },
        create: {
            user_id: userId,
            token: token,
            expires: new Date(Date.now() + TOKEN_EXPIRATION),
        },
        update: {
            token: token,
            expires: new Date(Date.now() + TOKEN_EXPIRATION),
        },
    });
    return token;
};

export const confirmVerificationToken = async (
    prismaInstance: PrismaClient,
    token: string
) => {
    const verificationToken = await prismaInstance.verificationToken.findUnique(
        {
            where: {
                token: token,
            },
        }
    );

    // Check if the token exists
    if (!verificationToken) {
        return false;
    }

    // Check if the token has expired
    if (verificationToken.expires < new Date()) {
        return false;
    }

    // Update the user's email_verified_at field
    await prismaInstance.user.update({
        where: {
            id: verificationToken.user_id,
        },
        data: {
            email_verified_at: new Date(),
        },
    });

    // Delete the verification token
    await prismaInstance.verificationToken.delete({
        where: {
            token: token,
        },
    });

    return true;
};
