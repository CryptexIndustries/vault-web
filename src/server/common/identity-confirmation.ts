import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { env } from "../../env/server.mjs";

enum TokenExpiration {
    ONE_DAY = 1000 * 60 * 60 * 24,
    ONE_WEEK = 1000 * 60 * 60 * 24 * 7,
}

const TOKEN_EXPIRATION = TokenExpiration.ONE_DAY;
const ACCOUNT_DEACTIVATION_TOKEN_EXPIRATION = TokenExpiration.ONE_WEEK;

const TOKEN_EXPIRATION_TEXT = "24 hours";
const ACCOUNT_DEACTIVATION_TOKEN_EXPIRATION_TEXT = "7 days";

export const verificationTemplate = (link: string) => {
    return `<!doctypehtml><title>Account Confirmation</title><style>@import url(https://fonts.googleapis.com/css2?family=Red+Hat+Display:ital,wght@0,400;0,500;1,300&display=swap);body{font-family:'Red Hat Display',sans-serif;font-size:18px;font-weight:400}.main{background-color:#181d2b;color:#fff}.content{height:100%;display:flex;flex-direction:column;align-items:center}.colorPrimary{color:#ff5668}.card{display:flex;max-width:512px;flex-direction:column;text-align:center;background-color:#262e43;border-color:#181d2b;border-style:solid;padding:20px;color:#fff;margin:10px}.button{background-color:#ff5668;color:#fff;padding:10px;text-decoration:none;display:inline-block;margin:10px 0}</style><body class="content main"><div class=card><h1 class=colorPrimary>Confirm Your Account</h1><p>Please click the button below to confirm your account.<br>The following link will be active for <b>{{TOKEN_EXPIRATION}}</b>.</p><a class=button href={{CONFIRMATION_LINK}}>Confirm Account</a><p>If you do not activate your account within <b>{{ACCOUNT_DEACTIVATION}}</b>, the account will be deactivated.<p>Please do not reply to this email. This mailbox is not monitored and you will not receive a response.</div>`
        .replace("{{CONFIRMATION_LINK}}", link)
        .replace("{{TOKEN_EXPIRATION}}", TOKEN_EXPIRATION_TEXT)
        .replace(
            "{{ACCOUNT_DEACTIVATION}}",
            ACCOUNT_DEACTIVATION_TOKEN_EXPIRATION_TEXT
        );
};

const generateVerificationLink = (token: string): string => {
    return `${env.NEXT_PUBLIC_APP_URL}/confirmation/${token}`;
};

const generateToken = (): string => {
    // Genereate a random token from 3 random UUIDs contatenated with a '-'
    return [randomUUID(), randomUUID(), randomUUID()].join("-");
};

export const updateUserIdentityConfirmationExpiery = async (
    prismaInstance: PrismaClient,
    userId: string
) => {
    await prismaInstance.user.update({
        where: {
            id: userId,
        },
        data: {
            email_verification_expires_at: new Date(
                Date.now() + ACCOUNT_DEACTIVATION_TOKEN_EXPIRATION
            ),
        },
    });
};

/**
 * Issue a new verification token for the user.
 * This will delete the existing verification token and create a new one.
 * Will also update the user's email_verification_expires_at field.
 * @param prismaInstance Instance of PrismaClient
 * @param userId ID of the user
 * @returns The the verification link
 */
export const issueNewVerificationToken = async (
    prismaInstance: PrismaClient,
    userId: string
) => {
    // Create a new verification token
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

    return generateVerificationLink(token);
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
        // Delete the verification token
        await prismaInstance.verificationToken.delete({
            where: {
                token: token,
            },
        });

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
