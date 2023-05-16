import Stripe from "stripe";
import { Stripe as StripeNS } from "stripe";
import { Stripe as StripeJS, loadStripe } from "@stripe/stripe-js";

// This is a frontend helper function, so we can use the publishable key
let stripePromiseFrontend: Promise<StripeJS | null>;
const getStripeFrontent = () => {
    if (!stripePromiseFrontend) {
        stripePromiseFrontend = loadStripe(
            process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
        );
    }
    return stripePromiseFrontend;
};

export default getStripeFrontent;

export const StripeConfiguration: StripeNS.StripeConfig = {
    // https://github.com/stripe/stripe-node#configuration
    apiVersion: "2022-08-01",
};

// This is a backend function, so we can use the secret key
const stripeBackend = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "",
    StripeConfiguration
);
export const createCheckoutSession = async (
    userEmail: string,
    userId: string,
    priceId: string
): Promise<string> => {
    // NOTE: If we're using the customer id, we can't pass the email
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
        customer_email: userEmail,
        metadata: {
            userId: userId,
        },
        // customer: currentCustomerId,
        success_url: `${
            process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
        }/app?checkout_success=true`,
        cancel_url: `${
            process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
        }/app?checkout_success=false`,
    });

    return checkoutSession.id;
};

export const getBillingPortalSession = async (
    customerId: string
): Promise<Stripe.Response<Stripe.BillingPortal.Session>> =>
    await stripeBackend.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${
            process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
        }/app`,
    });

export const getCheckoutUrl = async (
    checkoutSessionId: string
): Promise<string | null> =>
    (await stripeBackend.checkout.sessions.retrieve(checkoutSessionId)).url;
