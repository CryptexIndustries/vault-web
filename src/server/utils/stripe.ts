import Stripe from "stripe";
import { Stripe as StripeNS } from "stripe";
import { env } from "../../env/client.mjs";

export const StripeConfiguration: StripeNS.StripeConfig = {
    // https://github.com/stripe/stripe-node#configuration
    apiVersion: "2023-10-16",
};

// This is a backend function, so we can use the secret key
const stripeBackend = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "",
    StripeConfiguration,
);
export const createCheckoutSession = async (
    userID: string,
    priceId: string,
): Promise<string> => {
    const checkoutSession = await stripeBackend.checkout.sessions.create({
        mode: "subscription",
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        automatic_tax: {
            enabled: true,
        },
        subscription_data: {
            metadata: {
                user_id: userID,
            },
        },
        success_url: `${env.NEXT_PUBLIC_APP_URL}/app?checkout_success=true`,
        cancel_url: `${env.NEXT_PUBLIC_APP_URL}/app?checkout_success=false`,
    });

    return checkoutSession.id;
};

export const getBillingPortalSession = async (
    customerId: string,
): Promise<Stripe.Response<Stripe.BillingPortal.Session>> =>
    await stripeBackend.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${
            process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
        }/app`,
    });

export const getCheckoutUrl = async (
    checkoutSessionId: string,
): Promise<string | null> =>
    (await stripeBackend.checkout.sessions.retrieve(checkoutSessionId)).url;

export const getSubscription = async (id: string) =>
    await stripeBackend.subscriptions.retrieve(id);

export const getLatestInvoice = async (id: string) =>
    await stripeBackend.invoices.retrieve(id);
