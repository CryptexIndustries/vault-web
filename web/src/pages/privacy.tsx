import { NextPage } from "next/types";

import HTMLHeader from "@/components/html-header";
import HTMLMain from "@/components/html-main";
import NavBar from "@/components/navbar";

const PrivacyPolicy: NextPage = () => {
    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Privacy Policy"
                description="Cryptex Vault's privacy policy."
            />

            <HTMLMain>
                <NavBar />

                <div className="content">
                    <div className="mt-0 flex w-full flex-col items-center px-5 text-slate-200 md:mt-10 md:px-0">
                        <h1 className="text-4xl font-bold">Privacy Policy</h1>
                        <div className="mb-5 max-w-lg">
                            <h2 className="mt-10 text-2xl font-bold">
                                1. Data collection and usage
                            </h2>
                            <h3 className="mt-5 text-xl font-bold">
                                1.1. Personal data
                            </h3>
                            <p className="pt-2 text-justify">
                                The only personal data we collect is the users
                                email address when the contact form is filled
                                out. We use this data to contact the user if
                                they have any questions, concerns or to send the
                                user information about new features. We do not
                                share this data with any third parties.
                            </p>
                            <h3 className="mt-5 text-xl font-bold">
                                1.2. Personal data (Creating and using an
                                account or the application itself)
                            </h3>
                            <p className="pt-2 text-justify">
                                We do no collect any personal data from our
                                users.
                            </p>
                            <h3 className="mt-5 text-xl font-bold">
                                1.3. Payment Information
                            </h3>
                            <p className="pt-2 text-justify">
                                We rely on Stripe to process credit card, debit
                                card, and other payment information for Premium
                                subscriptions. We do not store or collect your
                                payment card number or security code. That
                                information is provided directly to Stripe,
                                whose use of your personal information is
                                governed by the{" "}
                                <a
                                    href="https://stripe.com/privacy"
                                    className="font-bold underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Stripe Privacy Policy
                                </a>
                                .
                            </p>
                            <h3 className="mt-5 text-xl font-bold">
                                1.4. Optional managed encrypted backups
                            </h3>
                            <p className="pt-2 text-justify">
                                Premium users may explicitly enable managed
                                backups. We store encrypted vault backup bytes
                                and operational metadata such as upload time,
                                encrypted size, source device identifier, and
                                access timing. Vault passwords, vault recovery
                                codes, encryption keys, second-factor secrets,
                                and plaintext vault contents are never sent to
                                the backup service. Disabling backups pauses new
                                uploads; users may download or delete retained
                                restore points according to the displayed
                                retention policy.
                            </p>
                        </div>
                    </div>
                </div>
            </HTMLMain>
        </>
    );
};

export default PrivacyPolicy;
