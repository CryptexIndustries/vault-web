import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { buffer } from "micro";

import { StripeConfiguration } from "../../utils/stripe";
import { PrismaClient } from "@prisma/client";
import NextCors from "nextjs-cors";
import { initUserSubscriptionTier } from "../../utils/subscription";

// Stripe requires the raw body to construct the event.
export const config = {
    api: {
        bodyParser: false,
    },
};

const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "",
    StripeConfiguration
);

const prisma = new PrismaClient();

// Docs: https://stripe.com/docs/api
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    await NextCors(req, res, {
        // Options
        methods: ["POST"],
        origin: "*",
        optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });

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
                    `[Stripe] Failed to parse webhook event. Error message: ${err.message}`
                );
                res.status(400).send("Bad signature");
            } else {
                // Unknown server error
                console.error(
                    `[Stripe] Failed to parse webhook event. Error: ${err}`
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
                    `[Stripe] [${event.type}] || InvoiceID: ${invoice.id} || Error: Invalid invoice ID`
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            const customerId = invoice.customer as string;
            const customerEmail = invoice.customer_email;

            // Early exit if the invoice is invalid
            if (
                !invoice?.subscription ||
                typeof invoice?.subscription !== "string"
            ) {
                console.error(
                    `[Stripe] [${event.type}] || InvoiceID: ${invoice.id} CustomerID: ${customerId} Customer email: ${customerEmail} || Error: Invalid invoice`
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            // Early exit if the customer email is invalid
            if (!customerEmail?.length) {
                console.error(
                    `[Stripe] [${event.type}] || CustomerID: ${customerId} Customer email: ${customerEmail} || Error: Invalid customerEmail`
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            // console.log(
            //     event.type + " -----",
            //     customerId,
            //     customerEmail,
            //     invoice
            // );

            await updateSubscription(
                event.type,
                customerId,
                customerEmail,
                invoice.subscription,
                res
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
                    `[Stripe] [${event.type}] || CustomerID: ${customerId} || Error: Missing customerId`
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
                    `[Stripe] [${event.type}] || CustomerID: ${customerId} || Error: Customer was deleted, cannot upsert subscription`
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            const customerEmail = customer.email;

            // Early exit if the customer email is invalid
            if (!customerEmail?.length) {
                console.error(
                    `[Stripe] [${event.type}] || CustomerID: ${customerId} Customer email: ${customerEmail} || Error: Invalid customerEmail`
                );

                // Don't send an error, because we don't want to retry the webhook
                res.status(200).send({ received: true });
                return;
            }

            await updateSubscription(
                event.type,
                customerId,
                customerEmail,
                _subscription.id as string,
                res
            );
        } else if (event.type === "customer.subscription.deleted") {
            // Here we get the customer.subscription.deleted event
            // Remove the subscription from the database

            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;

            if (!customerId?.length) {
                console.error(
                    `[Stripe] [customer.subscription.deleted] || CustomerID: ${customerId} || Error: Missing customerId`
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
                    email: true,
                },
            });

            if (deletedSubscription) {
                // Here we delete all user API keys in the database
                await prisma.aPIKey.deleteMany({
                    where: {
                        user_id: deletedSubscription.user_id,
                    },
                });

                // Initialize the users tier only if the user ID is provided (we have to know which user to initialize the tier data for)
                await initUserSubscriptionTier(
                    prisma,
                    deletedSubscription.user_id,
                    deletedSubscription.email,
                    true
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
                    `[Stripe] [customer.deleted] || CustomerID: ${customerId} || Error: Invalid customerEmail`
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
                        {
                            email: customerEmail,
                        },
                    ],
                },
                select: {
                    user_id: true,
                    email: true,
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

                // Here we delete all user API keys in the database
                await prisma.aPIKey.deleteMany({
                    where: {
                        user_id: deletedSubscription.user_id,
                    },
                });

                // Initialize the users tier only if the user ID is provided (we have to know which user to initialize the tier data for)
                await initUserSubscriptionTier(
                    prisma,
                    deletedSubscription.user_id,
                    deletedSubscription.email,
                    true
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

const updateSubscription = async (
    eventType: string,
    customerId: string,
    customerEmail: string,
    subscriptionId: string,
    res: NextApiResponse
) => {
    // Get user_id with the email
    const userId = (
        await prisma.user.findFirst({
            where: {
                email: customerEmail,
            },
            select: {
                id: true,
            },
        })
    )?.id;

    if (!userId?.length) {
        console.error(
            `[Stripe] [${eventType}] || CustomerID: ${customerId} Customer email: ${customerEmail} || Error: Could not find user with email in database`
        );

        // Don't send an error, because we don't want to retry the webhook
        res.status(200).send({ received: true });
        return;
    }

    // Get the customers subscription from stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Validate the Stripe subscription object
    if (!subscription) {
        console.error(
            `[Stripe] [${eventType}] || CustomerID: ${customerId} Customer email: ${customerEmail} || Error: Could not find users subscription`
        );

        // Don't send an error, because we don't want to retry the webhook
        res.status(200).send({ received: true });
        return;
    }

    // NOTE: THIS MIGHT BE UNNECESSARY
    // Fetch the latest invoice from stripe
    const invoice = await stripe.invoices.retrieve(
        subscription.latest_invoice as string
    );

    // Here we update the subscription in the database
    await prisma.subscription.upsert({
        create: {
            user_id: userId,
            customer_id: customerId,
            email: customerEmail,
            created_at: new Date(subscription.current_period_start * 1000),
            expires_at: new Date(subscription.current_period_end * 1000),
            status: subscription.status.toString(),
            payment_status: invoice.status?.toString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            product_id: subscription.items.data[0]?.plan.product?.toString(),
        },
        update: {
            customer_id: customerId,
            created_at: new Date(subscription.current_period_start * 1000),
            expires_at: new Date(subscription.current_period_end * 1000),
            status: subscription.status.toString(),
            payment_status: invoice.status?.toString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            product_id: subscription.items.data[0]?.plan.product?.toString(),
        },
        where: {
            email: customerEmail, // This is a reliable way to find the subscription since we got the user ID using the email
        },
    });
};
