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
                                We rely on third parties to process credit card,
                                debit card, and other payment information. We do
                                not store or collect your payment card number or
                                security code. That information is provided
                                directly to our third-party payment processors
                                whose use of your personal information is
                                governed by their Privacy Policy.
                            </p>
                        </div>
                    </div>
                </div>
            </HTMLMain>
        </>
    );
};

export default PrivacyPolicy;
