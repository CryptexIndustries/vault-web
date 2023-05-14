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

const webhook = async (req: NextApiRequest, res: NextApiResponse) => {
    await NextCors(req, res, {
        // Options
        methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
        origin: "*",
        optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });

    if (req.method === "POST") {
        const buf = await buffer(req);
        const sig = req.headers["stripe-signature"];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

        if (!sig || !webhookSecret) {
            res.status(400).send(`Missing signature`);
            return;
        }

        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
            // } catch (err: Stripe.errors.StripeSignatureVerificationError) {
        } catch (err: any) {
            // On error, log and return the error message
            console.error(
                `❌ Failed to parse stripe webhook event. Error message: ${err.message}`
            );
            res.status(400).send(`Webhook Error: ${err.message}`);
            return;
        }

        // Successfully constructed event
        // console.log("✅ Success:", event.id, event.type);
        switch (event.type) {
            case "checkout.session.completed":
                // Here we get the metadata from the checkout session
                // The metadata contains the userId which we're going to use to connect the user to the subscription

                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.metadata?.userId;
                const customerId = session.customer as string;

                if (!userId || !customerId) {
                    console.error(
                        `❌ [checkout.session.completed] || UserID: ${userId} CustomerID: ${customerId} || Error: Missing userId or customerId`
                    );
                    res.status(400).send("Missing userId or customerId");
                    return;
                }

                // Here we create the subscription in the database
                await prisma.subscription.upsert({
                    where: {
                        user_id: userId,
                    },
                    create: {
                        user_id: userId,
                        customer_id: customerId,
                    },
                    update: {
                        customer_id: customerId,
                    },
                });

                // Here we upsert the subscription
                // console.log(event);
                break;
            case "invoice.paid":
                // Here we get the invoice.paid event
                // Update the subscription status in the database

                const invoice = event.data.object as Stripe.Invoice;
                const customerId_ = invoice.customer as string;

                const userId_ = (
                    await prisma.subscription.findFirst({
                        where: {
                            customer_id: customerId_,
                        },
                        select: {
                            user_id: true,
                        },
                    })
                )?.user_id;

                if (!userId_ || !customerId_) {
                    console.error(
                        `❌ [invoice.paid] || UserID: ${userId_} CustomerID: ${customerId_} || Error: Missing userId or customerId`
                    );
                    res.status(400).send("Missing userId or customerId");
                    return;
                }

                // Here we update the subscription in the database
                await prisma.subscription.update({
                    where: {
                        user_id: userId_,
                    },
                    data: {
                        payment_status: invoice.status?.toString(),
                    },
                });

                // console.log(event);
                break;
            case "invoice.payment_failed":
                // Here we get the invoice.payment_failed event
                // Update the subscription status in the database

                const invoice_ = event.data.object as Stripe.Invoice;
                const customerId_____ = invoice_.customer as string;

                const userId_____ = (
                    await prisma.subscription.findFirst({
                        where: {
                            customer_id: customerId_____,
                        },
                        select: {
                            user_id: true,
                        },
                    })
                )?.user_id;

                if (!userId_____ || !customerId_____) {
                    console.error(
                        `❌ [invoice.payment_failed] || UserID: ${userId_____} CustomerID: ${customerId_____} || Error: Missing userId or customerId`
                    );
                    res.status(400).send("Missing userId or customerId");
                    return;
                }

                // Here we update the subscription in the database
                await prisma.subscription.update({
                    where: {
                        user_id: userId_____,
                    },
                    data: {
                        payment_status: invoice_.status?.toString(),
                    },
                });

                // console.log(event);
                break;
            case "customer.subscription.created":
                // Here we get the customer.subscription.created event
                // Update the dates and status in the database

                const subscription = event.data.object as Stripe.Subscription;
                const customerId__ = subscription.customer as string;

                const userId__ = (
                    await prisma.subscription.findFirst({
                        where: {
                            customer_id: customerId__,
                        },
                        select: {
                            user_id: true,
                        },
                    })
                )?.user_id;

                if (!userId__ || !customerId__) {
                    console.error(
                        `❌ [customer.subscription.created] || UserID: ${userId__} CustomerID: ${customerId__} || Error: Missing userId or customerId`
                    );
                    res.status(400).send("Missing userId or customerId");
                    return;
                }

                // Here we update the subscription in the database
                await prisma.subscription.update({
                    where: {
                        user_id: userId__,
                    },
                    data: {
                        created_at: new Date(
                            subscription.current_period_start * 1000
                        ),
                        expires_at: new Date(
                            subscription.current_period_end * 1000
                        ),
                        status: subscription.status.toString(),
                        product_id:
                            subscription.items.data[0]?.plan.product?.toString(),
                    },
                });
                break;
            case "customer.subscription.updated":
                // Here we get the customer.subscription.updated event
                // Update the dates and status in the database

                const subscription_ = event.data.object as Stripe.Subscription;
                const customerId___ = subscription_.customer as string;

                const userId___ = (
                    await prisma.subscription.findFirst({
                        where: {
                            customer_id: customerId___,
                        },
                        select: {
                            user_id: true,
                        },
                    })
                )?.user_id;

                if (!userId___ || !customerId___) {
                    console.error(
                        `❌ [customer.subscription.updated] || UserID: ${userId___} CustomerID: ${customerId___} || Error: Missing userId or customerId`
                    );
                    res.status(400).send("Missing userId or customerId");
                    return;
                }

                // Here we update the subscription in the database
                await prisma.subscription.update({
                    where: {
                        user_id: userId___,
                    },
                    data: {
                        created_at: new Date(
                            subscription_.current_period_start * 1000
                        ),
                        expires_at: new Date(
                            subscription_.current_period_end * 1000
                        ),
                        status: subscription_.status.toString(),
                        cancel_at_period_end:
                            subscription_.cancel_at_period_end,
                        product_id:
                            subscription_.items.data[0]?.plan.product?.toString(),
                    },
                });

                // console.log(event);
                break;
            case "customer.subscription.deleted":
                // Here we get the customer.subscription.deleted event
                // Remove the subscription from the database

                const subscription__ = event.data.object as Stripe.Subscription;
                const customerId____ = subscription__.customer as string;

                const userId____ = (
                    await prisma.subscription.findFirst({
                        where: {
                            customer_id: customerId____,
                        },
                        select: {
                            user_id: true,
                        },
                    })
                )?.user_id;

                if (!userId____ || !customerId____) {
                    console.error(
                        `❌ [customer.subscription.deleted] || UserID: ${userId____} CustomerID: ${customerId____} || Error: Missing userId or customerId`
                    );
                    res.status(400).send("Missing userId or customerId");
                    return;
                }

                // Here we delete the subscription in the database
                await prisma.subscription.delete({
                    where: {
                        user_id: userId____,
                    },
                });

                // Here we delete all user API keys in the database
                await prisma.aPIKey.deleteMany({
                    where: {
                        user_id: userId____,
                    },
                });

                // Init the free tier for the user
                initUserSubscriptionTier(prisma, userId____);

                // console.log(event);
                break;
            default:
                // Unhandled event type
                break;
        }
    } else {
        res.setHeader("Allow", "POST");
        res.status(405).end("Method Not Allowed");
        return;
    }

    res.status(200).send({ received: true });
};

export default webhook;
