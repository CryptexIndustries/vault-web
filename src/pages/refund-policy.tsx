import { GetStaticProps, NextPage } from "next/types";
import HTMLHeader from "../components/html_header";
import HTMLMain from "../components/html_main";
import NavBar from "../components/navbar";

const RefundPolicy: NextPage = () => {
    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Refund Policy"
                description="Cryptex Vault's refund policy."
            />

            <HTMLMain>
                <NavBar />

                <div className="content">
                    <div className="mt-0 flex w-full flex-col items-center px-5 md:mt-10 md:px-0">
                        <h1 className="text-4xl font-bold">Refund Policy</h1>
                        <div className="mb-5 max-w-lg">
                            <h2 className="mt-10 text-2xl font-bold">
                                1. Refund terms
                            </h2>
                            <p className="pt-2 text-justify">
                                We offer a 14 days full refund policy. If
                                you&apos;re not satisfied with our product, you
                                can request a full refund within the first 14
                                days of your purchase.
                            </p>
                            <h2 className="mt-10 text-2xl font-bold">
                                2. Refund request
                            </h2>
                            <p className="pt-2 text-justify">
                                Refunds can be requested by accessing the Stripe
                                Customer Portal inside the Vault. In case
                                you&apos;re unable to access the Stripe Customer
                                Portal, please contact us via our contact form
                                or email us{" "}
                                <a
                                    href="mailto:contact@cryptex-vault.com"
                                    className="text-blue-500 underline"
                                >
                                    directly
                                </a>
                                .
                            </p>
                            <h2 className="mt-10 text-2xl font-bold">
                                3. Refund process
                            </h2>
                            <p className="pt-2 text-justify">
                                Once your refund request is initiated through
                                the Stripe Customer Portal, the refund will be
                                processed automatically. A credit will be
                                applied to your original method of payment
                                within a certain number of days. In cases where
                                assistance from our support team is required, we
                                will follow the same process once the refund
                                request is approved.
                            </p>
                        </div>
                    </div>
                </div>
            </HTMLMain>
        </>
    );
};

export const getStaticProps: GetStaticProps = async () => {
    return {
        props: {},
    };
};

export default RefundPolicy;
