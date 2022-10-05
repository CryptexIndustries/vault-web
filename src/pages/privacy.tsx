import Head from "next/head";
import { NextPage } from "next/types";
import NavBar from "../components/index/navbar";

const PrivacyPolicy: NextPage = () => {
    return (
        <>
            <Head>
                <title>Cryptex Vault</title>
                <meta name="description" content="" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main className="main">
                <NavBar />

                <div className="content min-h-screen">
                    <div className="flex flex-col items-center w-full mt-10">
                        <h1 className="text-4xl font-bold">Privacy Policy</h1>
                        <div className="max-w-lg">
                            <h2 className="text-2xl font-bold mt-10">
                                1. Data collection and usage
                            </h2>
                            <h3 className="text-xl font-bold mt-5">
                                1.1. Personal data (Visiting our website)
                            </h3>
                            <p>
                                The only personal data we collect is the users
                                email address when the contact form is filled
                                out. We use this data to contact the user if
                                they have any questions, concerns or to send the
                                user information about new features. We do not
                                share this data with any third parties.
                            </p>
                            <h3 className="text-xl font-bold mt-5">
                                1.2. Personal data (Creating and using an
                                account)
                            </h3>
                            <p>
                                We collect as little information about the user
                                as possible. The only information we collect is
                                the user's email address, which is used to
                                identify the user and to send them emails
                                regarding their account. We do not collect any
                                other information about the user.
                            </p>
                            <h3 className="text-xl font-bold mt-5">
                                1.3. Payment Information
                            </h3>
                            <p>
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
            </main>
        </>
    );
};

export default PrivacyPolicy;
