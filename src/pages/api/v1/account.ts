import { PrismaClient, User } from "@prisma/client";
import { NextApiRequest, NextApiResponse } from "next";
import NextCors from "nextjs-cors";
// import { getServerAuthSession } from "../../../server/common/get-server-auth-session";
import { hashAPIKey } from "../../../utils/data_security";
import {
    initProductConfiguration,
    PAYMENT_TIERS,
    REVERSE_TIER_MAP,
} from "../../../utils/subscription";

const prisma = new PrismaClient();

const account = async (req: NextApiRequest, res: NextApiResponse) => {
    // This api handler is supposed to be accessed from the outside
    await NextCors(req, res, {
        // Options
        methods: ["GET"],
        origin: "*",
        optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });

    const user = await authenticateByAPIKey(req);

    if (user) {
        // Get the subscriptions from the db
        const subscriptions = await prisma.subscription.findFirst({
            where: {
                user_id: user.id,
            },
            select: {
                status: true,
                created_at: true,
                expires_at: true,
                product_id: true,
                customer_id: true,
                configuration: true,
            },
        });

        if (!subscriptions) {
            console.error(
                `[API - /account] User ID: |${user.id}| - doesn't have a subscription.`
            );
            res.status(500).send("INTERNAL_SERVER_ERROR");
            return;
        }

        // Get the configuration for the subscription
        // If the subscription doesn't have a configuration, initialize it
        const tierConfiguration =
            subscriptions.configuration ??
            (await initProductConfiguration(prisma));

        // Then look up the key in the REVERSE_TIER_MAP
        const tier: string | undefined =
            REVERSE_TIER_MAP[
                subscriptions.product_id ?? PAYMENT_TIERS.standard
            ];

        // Then return the tier name, start date, and end date, and the status of the subscription
        const data = {
            is_subscribed: subscriptions.status === "active",
            tier: tier ?? null,
            tier_flags: {
                linked_devices_max: tierConfiguration.allowed_api_keys,
            },
            created_at: subscriptions.created_at?.toISOString() ?? null,
            expires_at: subscriptions.expires_at?.toISOString() ?? null,
            customer_id: subscriptions.customer_id ?? null,
            status: subscriptions.status ?? null,
        };
        res.send(data);
    } else {
        res.status(401).send("UNAUTHORIZED");
    }
};

const authenticateByAPIKey = async (
    req: NextApiRequest
): Promise<User | undefined | null> => {
    // Extract the key from the header
    const apiKey = req.headers["authorization"];

    // If the key is present, match it against the database and return the user
    if (apiKey) {
        const user = (
            await prisma.aPIKey.findFirst({
                where: {
                    key: await hashAPIKey(apiKey as string),
                },
                select: {
                    user: true,
                },
            })
        )?.user;

        return user;
    }

    // If the key is not present, return null
    return null;
};

export default account;
