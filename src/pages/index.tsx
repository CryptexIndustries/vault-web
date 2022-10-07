import { GetStaticProps, NextPage } from "next";
import Head from "next/head";
import NavBar from "../components/navbar";
import IndexStyles from "../styles/Index.module.css";

import { CheckIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import { GenericModal } from "../components/general/modal";
import NotificationContainer from "../components/general/notificationContainer";
import { Accordion, AccordionItem } from "../components/general/accordion";
import { AnchorFullRoundFade } from "../components/buttons/full_round";
import React from "react";
import Spinner from "../components/general/spinner";

const NotifyMeForm = React.lazy(
    () => import("../components/index/notifyMeForm")
);
const ContactUsForm = React.lazy(
    () => import("../components/index/contactUsForm")
);

const Index: NextPage = ({}) => {
    const notifyMeModalVisibility = useState(false);
    const contactUsModalVisibility = useState(false);

    const showNotifyMeModal = () => notifyMeModalVisibility[1](true);
    const hideNotifyMeModal = () => notifyMeModalVisibility[1](false);
    const showContactUsModal = () => contactUsModalVisibility[1](true);
    const hideContactUsModal = () => contactUsModalVisibility[1](false);

    const notifyMeSubmitBtnRef = useRef<HTMLButtonElement>(null);
    const contactUsSubmitBtnRef = useRef<HTMLButtonElement>(null);

    return (
        <>
            <Head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <meta charSet="utf-8" />
                <title>Cryptex Vault - Decentralized Identity Manager</title>
                <meta
                    name="description"
                    content="No need to depend on any service that holds your passwords, secrets or other credentials."
                />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main className="main">
                <NavBar>
                    <div className="text-lg hidden lg:block">
                        <a
                            href="#section-home"
                            className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 transition-colors mr-4"
                        >
                            Home
                        </a>
                        <a
                            href="#section-about"
                            className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 transition-colors mr-4"
                        >
                            About
                        </a>
                        <a
                            href="#section-faq"
                            className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 transition-colors mr-4"
                        >
                            FAQ
                        </a>
                        <a
                            href="#section-pricing"
                            className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 transition-colors"
                        >
                            Pricing
                        </a>
                    </div>
                    <div className="hidden md:block">
                        <AnchorFullRoundFade
                            text="Notify me"
                            onClick={showNotifyMeModal}
                        />
                    </div>
                </NavBar>

                <div className="content">
                    <section
                        id="section-home"
                        className="h-full snap-center pb-16 bg-grid pt-0 md:pt-10 sm:pt-0 px-5"
                    >
                        <div className="h-full flex items-center justify-evenly">
                            <div>
                                <h1 className="font-medium text-5xl md:text-7xl text-center md:text-start">
                                    Fully{" "}
                                    <span className="text-5xl md:text-7xl text-rose-400">
                                        Decentralized
                                    </span>
                                    <br />
                                    Identity Manager
                                </h1>
                                <p className="ml-2 pt-5 text-gray-300">
                                    No need to depend on any service that holds
                                    your passwords, secrets or other
                                    credentials.
                                </p>
                                <p className="ml-2 text-gray-300">
                                    It&apos;s your data and nobody should be
                                    able to read it, except <b>you</b>.
                                </p>
                                <br />
                                <p className="ml-2 text-gray-300">
                                    That&apos;s why we built{" "}
                                    <b className="text-rose-400">
                                        Cryptex Vault
                                    </b>
                                    .
                                </p>
                                <p className="ml-2 text-gray-300">
                                    We can&apos;t even know what you store in
                                    your vault and that is because your data
                                    does not touch our servers.
                                </p>
                                <p className="ml-2 text-gray-300">
                                    Our job is to make sure your devices are
                                    connected and synchronized. That&apos;s it.
                                </p>
                                <div className="mt-20">
                                    <Link href={"#section-about"}>
                                        <div>
                                            <AnchorFullRoundFade
                                                text="Tell me more!"
                                                className="py-5 px-10 mr-7"
                                            />
                                        </div>
                                    </Link>
                                </div>
                            </div>
                            <div className="hidden lg:block">
                                <Image
                                    width={986 / 1.5}
                                    height={1105 / 1.5}
                                    priority={true}
                                    alt=""
                                    src="/images/logo/CV_Web-Background_3D_CUT.png"
                                    quality={80}
                                ></Image>
                            </div>
                        </div>
                    </section>

                    <hr className="opacity-20 w-3/4 ml-auto mr-auto mt-auto mb-auto"></hr>

                    <section
                        id="section-about"
                        className="h-full py-16 px-5 sm:px-0"
                    >
                        <div className="h-full flex flex-col sm:flex-row items-center justify-evenly">
                            <div className="max-w-lg mb-7 sm:mb-0">
                                <h1 className="text-5xl text-gray-300 text-center sm:text-start">
                                    What is{" "}
                                    <b className="text-rose-400">
                                        Cryptex Vault{" "}
                                    </b>
                                    and why should you use it? <br />
                                </h1>
                            </div>
                            {/* Roses are red, violets are blue, we're here
                                    to protect you. */}
                            <div className="vertical-line h-96 hidden lg:block"></div>
                            <div className="max-w-lg">
                                <p className="text-gray-500 mb-2">
                                    What are we?
                                </p>
                                <p className="ml-4 text-gray-300 text-justify sm:text-start">
                                    Cryptex Vault is a fully decentralized
                                    identity manager. It allows you to store
                                    your credentials, secrets and other
                                    information in a secure way using mobile
                                    applications and browser extensions.
                                </p>
                                <p className="text-gray-500 mt-4 mb-2">
                                    How the rest of the industry works?
                                </p>
                                <p className="ml-4 text-gray-300 text-justify sm:text-start">
                                    Most of the password managers out there are
                                    centralized. They store your data on their
                                    servers, which means that they can read it.
                                    They can also sell your data to third
                                    parties. We don&apos;t want that. We want to
                                    give you the power to control your data.
                                </p>
                                <p className="text-gray-500 mt-4 mb-2">
                                    How we do it.
                                </p>
                                <p className="ml-3 text-gray-300 text-justify sm:text-start">
                                    Unlike other password managers, Cryptex
                                    Vault doesn&apos;t store your data.
                                    It&apos;s only stored on your devices, not
                                    servers.
                                    <br /> You can use it on any supported
                                    platform.
                                </p>

                                <p className="text-gray-500  mt-10 mb-2">
                                    Supported platforms (on launch)
                                </p>
                                <div className="flex flex-wrap justify-center items-center space-x-2">
                                    <div
                                        className={
                                            IndexStyles.zmBrowserImgChrome
                                        }
                                    ></div>
                                    <div
                                        className={IndexStyles.zmBrowserImgFox}
                                    ></div>
                                    <a>
                                        <Image
                                            width={200}
                                            height={80}
                                            alt="Get it on Google Play"
                                            src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
                                        />
                                    </a>
                                    <p className="text-gray-300">
                                        ... coming soon to the Apple App Store!
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <hr className="opacity-20 w-3/4 ml-auto mr-auto mt-auto mb-auto"></hr>

                    <section
                        id="section-faq"
                        className="h-full w-full sm:py-16"
                    >
                        <div className="mb-16">
                            <Accordion>
                                <h1 className="text-2xl font-medium leading-6 w-full text-center mt-2 mb-3">
                                    Frequently Asked Questions
                                </h1>
                                <AccordionItem title="What is a Vault?">
                                    A vault is a place to safely store your
                                    credentials and other stuff in the near
                                    future.
                                </AccordionItem>
                                <AccordionItem title="Where is my data?">
                                    Your data is only stored on your devices.
                                </AccordionItem>
                                <AccordionItem title="Will Cryptex Vault be open source?">
                                    There are plans to open source the project
                                    later in development. Stay tuned.
                                </AccordionItem>
                                <AccordionItem title="Why can't I see the pricing?">
                                    The pricing will be announced on product
                                    launch.
                                </AccordionItem>
                            </Accordion>
                        </div>
                    </section>

                    <hr className="opacity-20 w-3/4 ml-auto mr-auto mt-auto mb-auto"></hr>

                    <section
                        id="section-pricing"
                        className="h-full pt-16 pb-5 px-5 sm:px-0"
                    >
                        <div className="flex w-full justify-center">
                            <h1 className="text-5xl sm:text-7xl leading-snug text-center">
                                <span className="text-rose-400 font-medium">
                                    Choose{" "}
                                </span>
                                Your Plan
                            </h1>
                        </div>

                        <div className="flex w-full justify-center flex-col sm:flex-row mt-10 space-y-5 sm:space-y-0 space-x-0 sm:space-x-4 pb-14">
                            <div className={IndexStyles.pricingCard}>
                                <div className="flex flex-col max-w-md px-10 py-8 sm:py-16">
                                    <div className="mb-4">
                                        <h2 className="font-bold text-lg text-gray-400">
                                            Standard
                                        </h2>
                                        <div className="text-3xl font-bold">
                                            Free
                                        </div>
                                    </div>

                                    <p className="text-lg text-gray-300 mb-10">
                                        A good starting point for those who want
                                        to try out the product.
                                    </p>

                                    <AnchorFullRoundFade
                                        text="Get Started"
                                        className="py-5 px-10"
                                        disabled={true}
                                    />
                                    <div className="mt-5 sm:mt-12">
                                        <div className="mb-6">
                                            <div className="text-gray-200 font-bold">
                                                What&apos;s included:
                                            </div>
                                        </div>
                                        <div className="flex flex-col space-y-4">
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Personal secure credentials
                                                    storage
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Stores unlimited credentials
                                                    per vault
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    A secure vault
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Encrypted backups to
                                                    external services
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Data sync (with 1 device)
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className={IndexStyles.pricingCard}>
                                <div className="flex flex-col max-w-md px-10 py-8 sm:py-16">
                                    <div className="mb-4">
                                        <h2 className="font-bold text-lg text-gray-400">
                                            Premium
                                        </h2>
                                        <div className="flex items-end">
                                            <div className="text-3xl font-bold">
                                                € ???
                                            </div>
                                            <div className="text-xl ml-1">
                                                / month
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-lg text-gray-300 mb-10">
                                        For those who want{" "}
                                        <span className="text-red-400">
                                            more{" "}
                                        </span>
                                        than just a secure password manager.
                                    </p>

                                    <AnchorFullRoundFade
                                        text="Get Started"
                                        className="py-5 px-10"
                                        disabled={true}
                                    />
                                    <div className="mt-5 sm:mt-12">
                                        <div className="mb-6">
                                            <div className="text-gray-200 font-bold">
                                                What&apos;s included:
                                            </div>
                                        </div>
                                        <div className="flex flex-col space-y-4">
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Mutiple secure vaults
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Automated encrypted backups
                                                    to external services
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Feature Voting
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Credentials borrowing
                                                    (password sharing)
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Data sync (with unlimited
                                                    devices)
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Everything from the standard
                                                    plan
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section
                        id="notify-launch"
                        className="h-full bg-colorPrimary flex flex-col justify-center py-10 px-2"
                    >
                        <h1 className="text-4xl font-bold text-center text-gray-200">
                            Get notified when we launch!
                        </h1>
                        <div className="flex flex-col sm:flex-row justify-center mt-6">
                            <div>
                                <button
                                    className="bg-rose-400 hover:opacity-70 text-white font-bold py-2 px-4 w-full sm:w-fit rounded-md transition-opacity sm:ml-4 mt-2 sm:mt-0"
                                    onClick={showNotifyMeModal}
                                >
                                    Notify me
                                </button>
                            </div>
                        </div>
                    </section>
                </div>

                <footer className="bg-gray-900 pt-10 pb-5 px-2 flex flex-col items-center w-full">
                    <div className="flex flex-col sm:flex-row justify-around w-full mb-4">
                        <div>
                            <h1 className="text-4xl font-bold text-gray-200">
                                Get in touch
                            </h1>
                            <p className="text-gray-300 mt-1">
                                Feel free to contact us for any questions or to
                                learn more about our service.
                            </p>
                        </div>
                        <div className="flex flex-col sm:ml-4 mt-4 sm:mt-0 justify-center text-center sm:text-left">
                            <button
                                className="bg-rose-400 hover:opacity-70 text-white font-bold py-2 px-4 w-full w-full rounded-md transition-opacity"
                                onClick={showContactUsModal}
                            >
                                Contact us
                            </button>
                            <p className="text-gray-300">
                                We care about the protection of your data.
                                <br /> Read our {""}
                                <Link href="/privacy">
                                    <a className="underline font-bold">
                                        Privacy Policy
                                    </a>
                                </Link>
                                .
                            </p>
                        </div>
                    </div>
                    <div className="text-center mt-4">
                        <h1 className="text-sm text-gray-400">
                            Made with ❤️ by the team at Cryptex Vault.
                        </h1>
                        <h1 className="text-sm text-gray-400">
                            All rights reserved. © {new Date().getFullYear()}{" "}
                            Cryptex Vault
                        </h1>
                    </div>
                </footer>
            </main>

            <GenericModal
                key="notify-me-modal"
                visibleState={notifyMeModalVisibility}
                confirmButtonText={"Notify Me"}
                onConfirm={() => notifyMeSubmitBtnRef.current?.click()}
            >
                <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold text-gray-900">
                        Get notified when we&apos;re launching!
                    </h1>
                    <p className="text-gray-700 mt-2">
                        Enter your email below to get notified when we&apos;re
                        launching.
                    </p>

                    <Suspense fallback={<Spinner />}>
                        <NotifyMeForm
                            hideModalFn={hideNotifyMeModal}
                            submitButtonRef={notifyMeSubmitBtnRef}
                        />
                    </Suspense>
                </div>
            </GenericModal>

            <GenericModal
                key="contact-us-modal"
                visibleState={contactUsModalVisibility}
                confirmButtonText={"Send"}
                onConfirm={() => contactUsSubmitBtnRef.current?.click()}
            >
                <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold text-gray-900">
                        Contact us
                    </h1>

                    <p className="text-gray-700 mt-2">
                        Feel free to contact us for any questions or to learn
                        more about our service.
                    </p>
                    <Suspense fallback={<Spinner />}>
                        <ContactUsForm
                            hideModalFn={hideContactUsModal}
                            submitButtonRef={contactUsSubmitBtnRef}
                        />
                    </Suspense>
                </div>
            </GenericModal>
            <NotificationContainer />
        </>
    );
};

export const getStaticProps: GetStaticProps = async () => {
    return {
        props: {},
    };
};

export default Index;
