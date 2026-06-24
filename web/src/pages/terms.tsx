import { NextPage } from "next/types";

import HTMLHeader from "@/components/html-header";
import HTMLMain from "@/components/html-main";
import NavBar from "@/components/navbar";

const TermsOfService: NextPage = () => {
    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Terms of Service"
                description="Cryptex Vault's terms of service."
            />

            <HTMLMain>
                <NavBar />

                <div className="content">
                    <div className="mt-0 flex w-full flex-col items-center px-5 text-slate-200 md:mt-10 md:px-0">
                        <h1 className="text-4xl font-bold">Terms of Service</h1>
                        <div className="mb-5 max-w-lg">
                            <h2 className="mt-10 text-2xl font-bold">
                                1. Subscriptions and billing
                            </h2>
                            <p className="pt-2 text-justify">
                                Cryptex Vault Premium is offered as a recurring
                                subscription. When you subscribe, you authorize
                                us and our payment processor, Stripe, to charge
                                your payment method at the price and interval
                                shown at checkout until you cancel.
                            </p>
                            <p className="pt-2 text-justify">
                                Subscriptions renew automatically at the end of
                                each billing period unless you cancel before
                                renewal. You may cancel at any time through the
                                Manage billing option in your account, which
                                opens the Stripe Customer Portal.
                            </p>
                            <h2 className="mt-10 text-2xl font-bold">
                                2. Payment processing
                            </h2>
                            <p className="pt-2 text-justify">
                                Payment card and billing details are collected
                                and processed by Stripe. Cryptex Industries
                                d.o.o. does not store your full payment card
                                number. Stripe&apos;s terms and privacy policy
                                apply to payment processing.
                            </p>
                            <h2 className="mt-10 text-2xl font-bold">
                                3. Changes and contact
                            </h2>
                            <p className="pt-2 text-justify">
                                We may update these terms or subscription
                                pricing with notice where required by law.
                                Continued use of a paid subscription after
                                changes take effect constitutes acceptance of
                                the updated terms.
                            </p>
                        </div>
                    </div>
                </div>
            </HTMLMain>
        </>
    );
};

export default TermsOfService;
