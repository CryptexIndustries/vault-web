import type { NextApiRequest, NextApiResponse } from "next";
import Pusher from "pusher";
import { PrismaClient } from "@prisma/client";
import Cors from "cors";

import { getServerAuthSession } from "../../../server/common/get-server-auth-session";
import { env } from "../../../env/client.mjs";
import { env as serverEnv } from "../../../env/server.mjs";
import { checkRatelimitPusher } from "../../../server/common/ratelimiting";
import runMiddleware from "../../../server/common/api-middleware";
import ipFromHeaders from "../../../server/common/ip-collection";

const cors = Cors({
    methods: ["POST"],
    origin: process.env.NEXT_PUBLIC_APP_URL,
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
});

const pusher = new Pusher({
    appId: env.NEXT_PUBLIC_PUSHER_APP_ID,
    key: env.NEXT_PUBLIC_PUSHER_APP_KEY,
    secret: serverEnv.PUSHER_APP_SECRET,
    useTLS: env.NEXT_PUBLIC_PUSHER_APP_TLS,
    host: env.NEXT_PUBLIC_PUSHER_APP_HOST,
    port: env.NEXT_PUBLIC_PUSHER_APP_PORT,
    // encryptionMasterKeyBase64: ENCRYPTION_MASTER_KEY, // a base64 string which encodes 32 bytes, used to derive the per-channel encryption keys (see below!)
});

const prisma = new PrismaClient();

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
    // This api handler is supposed to be accessed from this domain
    // This way we don't query the database for every request
    await runMiddleware(req, res, cors);

    const ip = ipFromHeaders(req.headers);
    if (!checkRatelimitPusher(ip)) {
        res.status(429).send("Too Many Requests");
        return;
    }

    // Get the user session
    const session = await getServerAuthSession({
        req,
        res,
    });

    // If the user doesn't have a session, return an error
    if (!session || !session.user) {
        res.status(401).send("Unauthorized");
        return;
    }

    // Check if the user has a subscription that allows them to use the vault linking
    const subscriptionConfig = await prisma.user.findFirst({
        where: {
            id: session.user.id,
        },
        select: {
            subscription: {
                select: {
                    configuration: {
                        select: {
                            linking_allowed: true,
                        },
                    },
                },
            },
        },
    });

    // If the user doesn't have a subscription, return an error
    if (!subscriptionConfig?.subscription[0]?.configuration?.linking_allowed) {
        res.status(401).send("Unauthorized");
        return;
    }

    // Get the socket id and channel name from the request body
    const { socket_id, channel_name } = req.body;

    // console.warn("SESSION-----", session);
    // console.warn("PUSHER AUTH-----", socket_id, channel_name);
    // console.warn("PUSHER AUTH-----", req.body);

    // The prefix should be "presence-" or "private-"
    // The label after that should be "link" or "sync"
    if (
        !channel_name.startsWith("presence-link") &&
        !channel_name.startsWith("presence-sync") &&
        !channel_name.startsWith("private-link") &&
        !channel_name.startsWith("private-sync")
    ) {
        res.status(401).send("Unauthorized");
        return;
    }

    if (
        channel_name.startsWith("presence-sync") ||
        channel_name.startsWith("private-sync")
    ) {
        // This is an example of a channel name: presence-sync-{senior_deviceID}_{junior_deviceID}
        const extractedDeviceIDs: string[] = channel_name
            .split("-")
            .slice(2)
            .join("-")
            .split("_");

        // Check if there are two device IDs (senior and junior) - valid channel name
        if (extractedDeviceIDs.length !== 2) {
            res.status(401).send("Unauthorized");
            return;
        }

        // Check if any of these device IDs belong to the user
        const belongsToUser = await prisma.account.count({
            where: {
                userId: session.user.id,
                id: session.user.accountID,
                providerAccountId: {
                    in: extractedDeviceIDs,
                },
            },
        });

        // If none of the devices belong to the user, return an error
        if (belongsToUser === 0) {
            console.error(
                "[PUSHER] None of the devices belong to the user",
                session.user.id,
                extractedDeviceIDs,
            );
            res.status(401).send("Unauthorized");
            return;
        }

        // Check if these account IDs belong to the user
        const accounts = await prisma.account.findMany({
            where: {
                userId: session.user.id,
                providerAccountId: {
                    in: extractedDeviceIDs,
                },
            },
        });

        // Both accounts should be found, otherwise return unauthorized
        if (accounts.length !== 2) {
            res.status(401).send("Unauthorized");
            return;
        }
    } else {
        // Remove the prefix that can be two words
        const channelNameWithoutPrefix = channel_name
            .split("-")
            .slice(2)
            .join("-");

        // Check if there is a UserID for that user in the Account table
        const account = await prisma.account.count({
            where: {
                userId: session.user.id,
                providerAccountId: channelNameWithoutPrefix,
            },
        });

        // If there is no account, return an error
        if (!account) {
            res.status(401).send("Unauthorized");
            return;
        }
    }

    // Create the presence data
    const userData = {
        user_id: session.user.accountID,
        user_info: {
            id: session.user.accountID,
            // name: session.user.name,
            // email: session.user.email,
        },
    };

    // Authenticate the request
    const auth = pusher.authorizeChannel(socket_id, channel_name, userData);

    // Send the response
    res.send(auth);
};

export default handler;
