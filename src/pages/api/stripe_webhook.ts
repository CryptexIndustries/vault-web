import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { buffer } from "micro";
import { PrismaClient } from "@prisma/client";
import Cors from "cors";

import { StripeConfiguration } from "../../server/utils/stripe";
import {
    updateSubscription,
    upsertUserSubscriptionTier,
} from "../../server/utils/subscription";
import runMiddleware from "../../server/common/api-middleware";

// Stripe requires the raw body to construct the event.
export const config = {
    api: {
        bodyParser: false,
    },
};

const cors = Cors({
    methods: ["POST"],
    origin: "*",
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
});

const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "",
    StripeConfiguration,
);

const prisma = new PrismaClient();

const removeAllButOldestAPIKey = async (
    prisma: PrismaClient,
    userId: string,
) => {
    // Here we delete all user API keys in the database
    // Pull all API keys from the database and remove all but the oldest one
    const apiKeys = await prisma.aPIKey.findMany({
        where: {
            user_id: userId,
        },
        orderBy: {
            created_at: "asc",
        },
    });

    // We want to keep the oldest API key
    // NOTE: The apiKeys[0].id is always defined - if the item at index 0 exists
    if (apiKeys.length > 1 && apiKeys[0]?.id) {
        await prisma.aPIKey.deleteMany({
            where: {
                user_id: userId,
                id: {
                    not: apiKeys[0].id,
                },
            },
        });

        if (!apiKeys[0].root) {
            // If the API key is not a root key, we want to make it a root key
            await prisma.aPIKey.update({
                where: {
                    id: apiKeys[0].id,
                },
                data: {
                    root: true,
                },
            });
        }
    }
};

// Docs: https://stripe.com/docs/api
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
) {
    await runMiddleware(req, res, cors);

    if (req.method === "POST") {
        const buf = await buffer(req);
        const sig = req.headers["stripe-signature"];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

        if (!sig || !webhookSecret) {
            res.status(400).send("Missing signature");
            return;
        }

        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
        } catch (err) {
            // On error, log and return the error message
            if (err instanceof Stripe.errors.StripeSignatureVerificationError) {
                console.error(
                    `[Stripe] Failed to parse webhook event. Error message: ${err.message}`,
                );
                res.status(400).send("Bad signature");
            } else {
                // Unknown server error
                console.error(
                    `[Stripe] Failed to parse webhook event. Error: ${err}`,
                );
                res.status(500).send("Internal server error");
            }

            return;
        }

        // Successfully constructed event - verified the signature
        if (
            event.type === "invoice.paid" ||
            event.type === "invoice.payment_failed"
        ) {
            // Here we get the invoice.paid event
            // Update the subscription status in the database

            const invoice = event.data.object as Stripe.Invoice;

            if (!invoice?.id?.length) {
                console.error(
                    `[Stripe] [${event.type}] || InvoiceID: ${invoice.id} || Error: Invalid invoice ID`,
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            const customerId = invoice.customer as string;
            const metadataUserID = invoice.subscription_details?.metadata
                ?.user_id as string;

            if (!metadataUserID?.length) {
                console.error(
                    `[Stripe] [${event.type}] || InvoiceID: ${invoice.id} CustomerID: ${customerId} || Error: Missing metadataUserID`,
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            // Early exit if the invoice is invalid
            if (
                !invoice?.subscription ||
                typeof invoice?.subscription !== "string"
            ) {
                console.error(
                    `[Stripe] [${event.type}] || InvoiceID: ${invoice.id} CustomerID: ${customerId} UserID: ${metadataUserID} || Error: Invalid invoice`,
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            await updateSubscription(
                prisma,
                res,
                event.type,
                customerId,
                metadataUserID,
                invoice.subscription,
                invoice.status?.toString(),
            );
        } else if (
            event.type === "customer.subscription.created" ||
            event.type === "customer.subscription.updated"
        ) {
            // Here we get the customer.subscription.created event
            // Update the dates and status in the database

            const _subscription = event.data.object as Stripe.Subscription;
            const customerId = _subscription.customer as string;

            if (!customerId?.length) {
                console.error(
                    `[Stripe] [${event.type}] || CustomerID: ${customerId} || Error: Missing customerId`,
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            // Get the customer from stripe
            const customer = await stripe.customers.retrieve(customerId);

            // console.log(event.type + " -----", customerId, _subscription);

            // If the customer was deleted, escape early
            if (customer.deleted) {
                console.debug(
                    `[Stripe] [${event.type}] || CustomerID: ${customerId} || Error: Customer was deleted, cannot upsert subscription`,
                );

                // Don't return an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            const metadataUserID = event.data.object.metadata
                ?.user_id as string;

            await updateSubscription(
                prisma,
                res,
                event.type,
                customerId,
                metadataUserID,
                _subscription.id as string,
            );
        } else if (event.type === "customer.subscription.deleted") {
            // Here we get the customer.subscription.deleted event
            // Remove the subscription from the database

            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;

            if (!customerId?.length) {
                console.error(
                    `[Stripe] [customer.subscription.deleted] || CustomerID: ${customerId} || Error: Missing customerId`,
                );

                res.status(200).send({ received: true });
                return;
            }

            // console.log(
            //     "customer.subscription.deleted -----",
            //     customerId,
            //     subscription
            // );

            // Here we find the subscription that was deleted
            const deletedSubscription = await prisma.subscription.findFirst({
                where: {
                    customer_id: customerId,
                },
                select: {
                    user_id: true,
                },
            });

            if (deletedSubscription) {
                await removeAllButOldestAPIKey(
                    prisma,
                    deletedSubscription.user_id,
                );

                // Initialize the users tier only if the user ID is provided (we have to know which user to initialize the tier data for)
                await upsertUserSubscriptionTier(
                    prisma,
                    deletedSubscription.user_id,
                );
            }
        } else if (event.type === "customer.deleted") {
            // Here we get the customer.deleted event
            // Remove the subscription from the database

            const customer = event.data.object as Stripe.Customer;
            const customerEmail = customer.email;
            const customerId = customer.id;

            if (!customerEmail?.length) {
                console.error(
                    `[Stripe] [customer.deleted] || CustomerID: ${customerId} || Error: Invalid customerEmail`,
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            // console.log("customer.deleted -----", customerId, customer);

            // Here we try to find the subscription of the deleted customer
            const deletedSubscription = await prisma.subscription.findFirst({
                where: {
                    OR: [
                        {
                            customer_id: customerId,
                        },
                    ],
                },
                select: {
                    user_id: true,
                },
            });

            if (deletedSubscription) {
                // Update the subsction customer_id field to point to the user ID - since the customer was deleted from the payment processor
                await prisma.subscription.update({
                    where: {
                        customer_id: customerId,
                    },
                    data: {
                        customer_id: deletedSubscription.user_id,
                    },
                });

                await removeAllButOldestAPIKey(
                    prisma,
                    deletedSubscription.user_id,
                );

                // Initialize the users tier only if the user ID is provided (we have to know which user to initialize the tier data for)
                await upsertUserSubscriptionTier(
                    prisma,
                    deletedSubscription.user_id,
                );
            } else {
                // console.debug(
                //     `[Stripe] [customer.deleted] || CustomerID: ${customerId} Customer email: ${customerEmail} || Silent warning: Could not find subscription of deleted customer, was probably deleted before the webhook event triggered.`
                // );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }
        } else {
            // Unhandled event type
        }
    } else {
        res.setHeader("Allow", "POST");
        res.status(405).end("Method Not Allowed");
        return;
    }

    res.status(200).send({ received: true });
}
