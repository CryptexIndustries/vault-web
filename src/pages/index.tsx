import { GetStaticProps, NextPage } from "next";
import NavBar from "../components/navbar";
import IndexStyles from "../styles/Index.module.css";
// import DownloadBadges from "../styles/DownloadBadges.module.css";

import { CheckIcon } from "@heroicons/react/24/outline";
import { InformationCircleIcon, ClockIcon } from "@heroicons/react/24/outline";

import React, { useMemo } from "react";
import { Suspense, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { clsx } from "clsx";

import { Body, Footer, GenericModal } from "../components/general/modal";
import NotificationContainer from "../components/general/notificationContainer";
import { Accordion, AccordionItem } from "../components/general/accordion";
import {
    AnchorFullRoundFade,
    ButtonFlat,
    ButtonType,
} from "../components/general/buttons";
import Spinner from "../components/general/spinner";
import PageFooter from "../components/general/footer";
import HTMLHeader from "../components/html_header";
import HTMLMain from "../components/html_main";
import { PAYMENT_TIERS } from "../utils/subscription";
import { NotifyMeReference } from "../components/index/notifyMeForm";

const NotifyMeForm = React.lazy(
    () => import("../components/index/notifyMeForm")
);
const ContactUsForm = React.lazy(
    () => import("../components/index/contactUsForm")
);

enum FeatureState {
    AvailableFree,
    AvailablePaid,
    NotAvailable,
}
type PricingFeatureItemProps = {
    title: string;
    description: string;
    visibleID: string | null;
    toggleFn: (id: string) => void;
    state?: FeatureState;
};
const PricingFeatureItem: React.FC<PricingFeatureItemProps> = ({
    title,
    description,
    visibleID,
    toggleFn,
    state = FeatureState.AvailableFree,
}) => {
    // Generate a random internal ID for this component
    const internalID = useMemo(() => {
        return `feature-${Math.random().toString(36)}`;
    }, []);

    const checkIconClass = clsx({
        "h-6 w-6": true,
        "text-rose-400":
            state === FeatureState.AvailablePaid ||
            state === FeatureState.AvailableFree,
        "text-gray-400": state === FeatureState.NotAvailable,
    });

    const containerClasses = clsx({
        "flex flex-col items-start": true,
        "text-gray-400": state === FeatureState.NotAvailable,
        "opacity-50": state === FeatureState.NotAvailable,
    });

    const descriptionIconClass = clsx({
        "h-6 w-6 cursor-pointer": true,
        "hover:text-gray-300": state !== FeatureState.NotAvailable,
        "cursor-default": state === FeatureState.NotAvailable,
        "text-gray-400": state === FeatureState.NotAvailable,
    });

    // If the feature is not available, we don't want to toggle the description
    if (state === FeatureState.NotAvailable) {
        toggleFn = () => {
            // Do nothing
        };
    }

    const descriptionVisible = visibleID === internalID;

    return (
        <div className={containerClasses}>
            <div className="flex w-full items-center justify-between">
                <div className="flex items-center">
                    <div className="mr-3.5">
                        {state !== FeatureState.NotAvailable && (
                            <CheckIcon className={checkIconClass} />
                        )}
                        {state === FeatureState.NotAvailable && (
                            <ClockIcon className={checkIconClass} />
                        )}
                    </div>
                    <div className="text-gray-200">{title}</div>
                </div>
                <div className="ml-2" title="Show more information">
                    <InformationCircleIcon
                        className={descriptionIconClass}
                        onClick={() => toggleFn(internalID)}
                    />
                </div>
            </div>
            <div
                id="test-container"
                className={
                    "overflow-hidden transition-all " +
                    (descriptionVisible ? "min-h-full" : "max-h-0")
                }
            >
                <p className="ml-10 border-l pl-2 text-sm text-gray-400">
                    {description}
                </p>
            </div>
        </div>
    );
};

type BannerProps = {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
};
const Banner: React.FC<BannerProps> = ({ title, subtitle, children }) => {
    return (
        <section className="bg-colorPrimary flex flex-col py-9 text-center">
            <p className="text-md break-normal px-2 font-bold sm:text-2xl">
                {title}
            </p>
            {subtitle && (
                <caption>
                    <p className="text-sm font-bold sm:text-2xl">{subtitle}</p>
                </caption>
            )}
            <div className="pt-4">{children}</div>
        </section>
    );
};

const Index: NextPage = ({}) => {
    const notifyMeModalVisibility = useState(false);
    const notifyMeModalReference = useState<NotifyMeReference>(null);
    const notifyMeModalSubmitting = useState(false);
    const contactUsModalVisibility = useState(false);
    const contactUsModalSubmitting = useState(false);

    const isNotifyMeModalSubmitting = notifyMeModalSubmitting[0];
    const currNotifyMeModalReference = notifyMeModalReference[0];
    const isContactUsModalSubmitting = contactUsModalSubmitting[0];

    const setNotifyMeModalReference = (ref: NotifyMeReference) => {
        notifyMeModalReference[1](ref);
    };
    const showNotifyMeModal = () => notifyMeModalVisibility[1](true);
    const hideNotifyMeModal = () => notifyMeModalVisibility[1](false);
    const showContactUsModal = () => contactUsModalVisibility[1](true);
    const hideContactUsModal = () => contactUsModalVisibility[1](false);

    const notifyMeSubmitBtnRef = useRef<HTMLButtonElement>(null);
    const contactUsSubmitBtnRef = useRef<HTMLButtonElement>(null);

    const [tierCardFeatureInfoVisible, setTierCardFeatureInfoVisible] =
        useState<string | null>(null);
    const toggleTierCardFeatureInfo = (tierFeatureID: string) => {
        if (tierCardFeatureInfoVisible === tierFeatureID) {
            setTierCardFeatureInfoVisible(null);
        } else {
            setTierCardFeatureInfoVisible(tierFeatureID);
        }
    };

    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Decentralized Identity Manager"
                description="No need to depend on any service that holds your passwords, secrets or other credentials."
            />

            <HTMLMain>
                <div className="bg-colorPrimary top-0 z-10 flex w-full justify-center px-2 text-center sm:sticky">
                    <p>
                        <b>CRYPTEX VAULT</b> is currently in <b>BETA</b>! If you
                        would like to suggest a feature or report a bug, please{" "}
                        <a
                            className="cursor-pointer underline hover:text-rose-200"
                            href="#"
                            onClick={showContactUsModal}
                        >
                            <b>contact us</b>
                        </a>
                        .
                    </p>
                </div>
                <NavBar>
                    <div className="hidden text-lg lg:block">
                        <a
                            href="#section-home"
                            className="mr-4 mt-4 block text-white transition-colors hover:text-rose-400 lg:mt-0 lg:inline-block"
                        >
                            Home
                        </a>
                        <a
                            href="#section-about"
                            className="mr-4 mt-4 block text-white transition-colors hover:text-rose-400 lg:mt-0 lg:inline-block"
                        >
                            About
                        </a>
                        <a
                            href="#section-faq"
                            className="mr-4 mt-4 block text-white transition-colors hover:text-rose-400 lg:mt-0 lg:inline-block"
                        >
                            FAQ
                        </a>
                        <a
                            href="#section-pricing"
                            className="mt-4 block text-white transition-colors hover:text-rose-400 lg:mt-0 lg:inline-block"
                        >
                            Pricing
                        </a>
                    </div>
                    <div className="hidden md:block">
                        <Link href={"/app"}>
                            <AnchorFullRoundFade text="Open Vault" />
                        </Link>
                    </div>
                </NavBar>

                <div className="content">
                    <section
                        id="section-home"
                        className="bg-grid h-full snap-center px-5 pb-16 pt-0 sm:pt-0 md:pt-10"
                    >
                        <div className="flex h-full items-center justify-evenly">
                            <div>
                                <h1 className="pb-5 text-center text-4xl font-medium md:text-start md:text-7xl">
                                    Fully{" "}
                                    <span className="text-4xl text-rose-400 md:text-7xl">
                                        Decentralized
                                    </span>
                                    <br />
                                    Identity Manager
                                </h1>
                                <p className="ml-2 mt-3 text-gray-300 sm:mt-0">
                                    We believe that your data is yours,
                                    encrypted or not, nobody should be able to
                                    read it, except <b>you</b>.
                                </p>
                                <p className="ml-2 text-gray-300">
                                    That&apos;s why we built{" "}
                                    <b className="text-rose-400">
                                        Cryptex Vault
                                    </b>
                                    .
                                </p>
                                <br />
                                <p className="ml-2 text-gray-300">
                                    At Cryptex Vault, we deeply believe in
                                    empowering you to take full control of your
                                    digital identity. <br />
                                    {/* We understand the importance of keeping your
                                    passwords, secrets, and credentials safe,{" "}
                                    <br /> without relying on external services
                                    that might compromise your privacy. */}
                                </p>
                                {/* <p className="ml-2 text-gray-300">
                                    Our commitment to privacy means your data
                                    remains exclusively yours, encrypted or not.{" "}
                                    <br />
                                    By keeping your information off our servers,
                                    the security of your data is guaranteed at
                                    the highest level.
                                </p> */}
                                <p className="ml-2 text-gray-300">
                                    Our job is to make sure your devices are
                                    connected and synchronized, that&apos;s it.
                                </p>
                                <div className="flex items-start">
                                    <div className="flex flex-col text-center">
                                        <div className="mt-10 md:mt-20">
                                            <Link href={"#section-pricing"}>
                                                <AnchorFullRoundFade
                                                    text="Start Now!"
                                                    className="px-8 py-3 md:mr-7 md:px-10 md:py-5"
                                                />
                                            </Link>
                                        </div>
                                        <p className="mb-4 mt-4 md:hidden">
                                            OR
                                        </p>
                                        <div className="md:hidden">
                                            <Link href={"/app"}>
                                                <AnchorFullRoundFade text="Open Vault" />
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="hidden select-none lg:block">
                                <Image
                                    width={986 / 1.5}
                                    height={1105 / 1.5}
                                    alt=""
                                    src="/images/logo/CV_Web-Background_3D_CUT.webp"
                                    quality={80}
                                ></Image>
                            </div>
                        </div>
                    </section>

                    <hr className="mb-auto ml-auto mr-auto mt-auto w-3/4 opacity-20"></hr>

                    <section
                        id="section-about"
                        className="h-full px-5 py-16 sm:px-0"
                    >
                        <div className="flex h-full flex-col items-center justify-evenly sm:flex-row">
                            <div className="mb-7 max-w-lg sm:mb-0">
                                <h1 className="text-center text-5xl text-gray-300 sm:text-start">
                                    What is{" "}
                                    <b className="text-rose-400">
                                        Cryptex Vault{" "}
                                    </b>
                                    and why should you use it? <br />
                                </h1>
                            </div>
                            {/* Roses are red, violets are blue, we're here
                                    to protect you. */}
                            <div className="vertical-line hidden h-96 lg:block"></div>
                            <div className="max-w-lg">
                                <p className="mb-2 text-gray-500">
                                    What are we?
                                </p>
                                <p className="ml-4 text-justify text-gray-300 sm:text-start">
                                    Cryptex Vault is a fully decentralized
                                    identity manager. It allows you to store and
                                    use your credentials, secrets and other
                                    information in a secure way using the web
                                    application and browser extensions. The web
                                    application can easily be used offline as it
                                    is a PWA (Progressive Web App).
                                </p>
                                <p className="mb-2 mt-4 text-gray-500">
                                    How the rest of the industry works?
                                </p>
                                <p className="ml-4 text-justify text-gray-300 sm:text-start">
                                    Most of the password managers out there are
                                    centralized. They store your data on their
                                    servers, which means that they can read it.
                                    They can also sell some of your data to
                                    third parties. We don&apos;t want that. We
                                    want to give you the power to control your
                                    data.
                                </p>
                                <p className="mb-2 mt-4 text-gray-500">
                                    How we do it.
                                </p>
                                <p className="ml-3 text-justify text-gray-300 sm:text-start">
                                    Unlike other password managers, Cryptex
                                    Vault doesn&apos;t store your data in the
                                    cloud. It&apos;s only stored on your
                                    devices, not servers. By keeping your
                                    information off our servers, the security of
                                    your data is guaranteed at the highest
                                    level.
                                    <br /> All modern browsers are supported,
                                    with browser extensions coming soon.
                                </p>

                                {/* <p className="mb-2 mt-10 hidden text-gray-500">
                                    Supported platforms (on launch)
                                </p> */}
                                {/* flex */}
                                {/* <div className="hidden flex-wrap items-center justify-center space-x-2">
                                    <div
                                        className={
                                            DownloadBadges.zmBrowserImgChrome
                                        }
                                    ></div>
                                    <div
                                        className={
                                            DownloadBadges.zmBrowserImgFox
                                        }
                                    ></div>
                                    // <a href="">
                                    //     <Image
                                    //         width={200}
                                    //         height={80}
                                    //         alt="Get it on Google Play"
                                    //         src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
                                    //     />
                                    // </a> 
                                    <p className="text-center text-gray-300">
                                        ... coming soon to the <br /> Google
                                        Play store & Apple App Store!
                                    </p>
                                </div> */}
                            </div>
                        </div>
                    </section>

                    <hr className="mb-auto ml-auto mr-auto mt-auto w-3/4 opacity-20"></hr>

                    <section
                        id="section-faq"
                        className="h-full w-full sm:py-16"
                    >
                        <div className="mb-16">
                            <Accordion>
                                <h1 className="mb-3 mt-2 w-full text-center text-2xl font-medium leading-6">
                                    Frequently Asked Questions
                                </h1>
                                <AccordionItem title="What is a Vault?">
                                    A vault is much like a safe. It is a place
                                    to store your credentials and other secrets
                                    locally, on your devices.
                                </AccordionItem>
                                <AccordionItem title="Where is my data?">
                                    The only copy of your data is stored on your
                                    devices. When you&apos;re synchronizing your
                                    vault, it is encrypted and sent directly to
                                    your other devices.
                                </AccordionItem>
                                <AccordionItem title="Will Cryptex Vault be open sourced?">
                                    There are plans to open source the project
                                    later in development. We believe that by
                                    doing so we can create a more secure and
                                    trustworthy product. Stay tuned.
                                </AccordionItem>
                                <AccordionItem title="Why can't I see the pricing for the Enterprise tier?">
                                    The pricing will be announced on product
                                    launch.
                                </AccordionItem>
                            </Accordion>
                        </div>
                    </section>

                    <hr className="mb-auto ml-auto mr-auto mt-auto w-3/4 opacity-20"></hr>

                    <section
                        id="section-pricing"
                        className="flex h-full flex-col px-0 pb-5 pt-16 sm:px-5"
                    >
                        <div className="flex w-full justify-center">
                            <h1 className="text-center text-5xl leading-snug sm:text-7xl">
                                <span className="font-medium text-rose-400">
                                    Choose{" "}
                                </span>
                                Your Plan
                            </h1>
                        </div>

                        <div className="mt-10 flex w-full flex-col items-center justify-center space-x-0 pb-5 sm:scale-100 sm:space-x-5 md:flex-row lg:pb-14">
                            <div className={IndexStyles.pricingCardScaled}>
                                <div className="flex max-w-md flex-col px-2 py-8 sm:px-10 sm:py-16">
                                    <div className="mb-4">
                                        <h2 className="text-lg font-bold text-gray-400">
                                            Standard
                                        </h2>
                                        <div className="text-3xl font-bold">
                                            Free
                                        </div>
                                    </div>

                                    <p className="mb-10 text-center text-lg text-gray-300">
                                        A good starting point for those who want
                                        to try out CryptexVault.
                                    </p>

                                    <Link href={"/app"}>
                                        <AnchorFullRoundFade
                                            text="Start Now"
                                            className="w-full px-10 py-5"
                                        />
                                    </Link>
                                    <div className="mt-5 sm:mt-12">
                                        <div className="mb-6">
                                            <div className="font-bold text-gray-200">
                                                What&apos;s included:
                                            </div>
                                        </div>
                                        <div className="flex flex-col space-y-4">
                                            <PricingFeatureItem
                                                title="Personal secure credentials storage"
                                                description="You can save secrets in the form of passwords, credit cards, etc."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailableFree
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Stores unlimited credentials per vault"
                                                description="We don't limit the amount of passwords (or other secrets) that you can save!"
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailableFree
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="A Secure Vault"
                                                description="This is where you save your credentials (passwords and other secrets)."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailableFree
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Create encrypted backups"
                                                description="Create an encrypted backup then upload it to your Google Drive, OneDrive, GitHub, GitLab, with a single press of a button."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailableFree
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            {/* <PricingFeatureItem
                                                title="Data sync (with 1 device)"
                                                description="Connect your vault to your browser! Which makes it easy to use your credentials within the browser."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailableFree
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            /> */}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className={IndexStyles.pricingCard}>
                                <div className="flex max-w-md flex-col px-2 py-8 sm:px-10 sm:py-16">
                                    <div className="mb-4">
                                        <h2 className="text-lg font-bold text-gray-400">
                                            Premium
                                        </h2>
                                        <div className="flex items-end">
                                            <div className="text-3xl font-bold">
                                                €4,99
                                            </div>
                                            <div className="ml-1 text-xl">
                                                / month
                                            </div>
                                        </div>
                                    </div>

                                    <p className="mb-10 text-center text-lg text-gray-300">
                                        For those who want{" "}
                                        <span className="text-red-400">
                                            more{" "}
                                        </span>
                                        than just a secure password manager.
                                    </p>

                                    <Link
                                        href={`/app?checkout=${PAYMENT_TIERS.premiumMonthly}`}
                                    >
                                        <AnchorFullRoundFade
                                            text="Buy Now"
                                            type={ButtonType.FadeGreen}
                                            className="w-full px-10 py-5"
                                        />
                                    </Link>
                                    <div className="mt-5 sm:mt-12">
                                        <div className="mb-6">
                                            <div className="font-bold text-gray-200">
                                                What&apos;s included:
                                            </div>
                                        </div>
                                        <div className="flex flex-col space-y-4">
                                            <PricingFeatureItem
                                                title="Everything from the standard plan"
                                                description="This tier includes everything from the free tier."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Unlimited secure vaults"
                                                description="You get unlimited vaults in which you can save credentials."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Data synchronization"
                                                description="Connect your vaults to your desktop, laptop, and your buddy's laptop browser to have access to the same credentials across multiple devices."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Feature Voting"
                                                description="Have the power to decide on the future of Cryptex Vault! Vote up the features you want to see implemented."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Automated encrypted backups to external services"
                                                description="Automatically creates and encrypts your vault backup then uploads it to your Google Drive, OneDrive, GitHub, GitLab - every time you make a change."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.NotAvailable
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Credentials borrowing (password sharing)"
                                                description="Share a password with a buddy or your family, securely - inside Cryptex Vault!"
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.NotAvailable
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className={IndexStyles.pricingCardScaled}>
                                <div className="flex max-w-md flex-col px-2 py-8 sm:px-10 sm:py-16">
                                    <div className="mb-4">
                                        <h2 className="text-lg font-bold text-gray-400">
                                            Enterprise
                                        </h2>
                                        <div className="flex items-end">
                                            <div className="text-3xl font-bold">
                                                € TBA
                                            </div>
                                            <div className="ml-1 hidden text-xl">
                                                / month
                                            </div>
                                        </div>
                                    </div>

                                    <p className="mb-10 text-center text-lg text-gray-300">
                                        For organizations seeking {""}
                                        <span className="text-red-400">
                                            advanced features
                                        </span>
                                        {""} and {""}
                                        <span className="text-red-400">
                                            robust security
                                        </span>
                                        , ensuring seamless team collaboration
                                        and efficient credential management.
                                    </p>

                                    <AnchorFullRoundFade
                                        text="Get Notified"
                                        className="px-10 py-5"
                                        onClick={() => {
                                            setNotifyMeModalReference(
                                                "enterprise-tier"
                                            );
                                            showNotifyMeModal();
                                        }}
                                    />
                                    <div className="mt-5 sm:mt-12">
                                        <div className="mb-6">
                                            <div className="font-bold text-gray-200">
                                                What&apos;s included:
                                            </div>
                                        </div>
                                        <div className="flex flex-col space-y-4">
                                            <PricingFeatureItem
                                                title="Everything from the standard and premium plan"
                                                description="This tier includes everything from the free tier."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="User account management and organization"
                                                description="Create and manage user accounts for your team members. Add users to a particular group for easy management."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                            <PricingFeatureItem
                                                title="Credentials management"
                                                description="Provision and control vaults and credentials for your team members, on a per user or group basis."
                                                visibleID={
                                                    tierCardFeatureInfoVisible
                                                }
                                                state={
                                                    FeatureState.AvailablePaid
                                                }
                                                toggleFn={
                                                    toggleTierCardFeatureInfo
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <Banner
                        title={"We are in beta, give us a try and let us know what you think!".toUpperCase()}
                    >
                        <Link href={"/app"}>
                            <ButtonFlat
                                text="GET STARTED"
                                className="font-semibold"
                                inhibitAutoWidth
                                type={ButtonType.Flat}
                            />
                        </Link>
                    </Banner>
                </div>

                <PageFooter>
                    <div
                        id="section-contact"
                        className="mb-4 flex w-full flex-col justify-around pt-10 sm:flex-row"
                    >
                        <div>
                            <h1 className="text-4xl font-bold text-gray-200">
                                Get in touch
                            </h1>
                            <p className="mt-1 text-gray-300">
                                Feel free to contact us for any questions or to
                                learn more about our service.
                            </p>
                        </div>
                        <div className="mt-4 flex flex-col justify-center text-center sm:ml-4 sm:mt-0 sm:text-left">
                            <button
                                className="w-full rounded-md bg-rose-400 px-4 py-2 font-bold text-white transition-opacity hover:opacity-70"
                                onClick={showContactUsModal}
                            >
                                Contact us
                            </button>
                            <p className="text-gray-300">
                                We care about the protection of your data.
                                <br /> Read our {""}
                                <Link
                                    href="/privacy"
                                    className="font-bold underline"
                                >
                                    Privacy Policy
                                </Link>
                                .
                            </p>
                            <p className="text-gray-300">
                                Also check out our {""}
                                <Link
                                    href="/refund-policy"
                                    className="font-bold underline"
                                >
                                    Refund Policy
                                </Link>
                                .
                            </p>
                        </div>
                    </div>
                </PageFooter>
            </HTMLMain>

            <GenericModal
                key="notify-me-modal"
                visibleState={notifyMeModalVisibility}
            >
                <Body>
                    <div className="flex flex-col items-center text-center">
                        <h1 className="text-2xl font-bold text-gray-900">
                            Get notified
                        </h1>
                        <p className="mt-2 text-gray-700">
                            Enter your email below and we will notify you when
                            it&apos;s ready.
                        </p>

                        <Suspense fallback={<Spinner />}>
                            <NotifyMeForm
                                hideModalFn={hideNotifyMeModal}
                                submitButtonRef={notifyMeSubmitBtnRef}
                                submittingState={notifyMeModalSubmitting}
                                reference={currNotifyMeModalReference}
                            />
                        </Suspense>
                    </div>
                </Body>
                <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                    <ButtonFlat
                        text="Notify Me"
                        className="sm:ml-2"
                        onClick={() => notifyMeSubmitBtnRef.current?.click()}
                        disabled={isNotifyMeModalSubmitting}
                        loading={isNotifyMeModalSubmitting}
                    />
                    <ButtonFlat
                        text="Close"
                        type={ButtonType.Secondary}
                        onClick={hideNotifyMeModal}
                    />
                </Footer>
            </GenericModal>

            <GenericModal
                key="contact-us-modal"
                visibleState={contactUsModalVisibility}
            >
                <Body>
                    <div className="flex flex-col items-center text-center">
                        <h1 className="text-2xl font-bold text-gray-900">
                            Contact us
                        </h1>

                        <p className="mt-2 text-gray-700">
                            Feel free to contact us for any questions or to
                            learn more about our service.
                        </p>
                        <Suspense fallback={<Spinner />}>
                            <ContactUsForm
                                hideModalFn={hideContactUsModal}
                                submitButtonRef={contactUsSubmitBtnRef}
                                submittingState={contactUsModalSubmitting}
                            />
                        </Suspense>
                    </div>
                </Body>

                <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                    <ButtonFlat
                        text="Send"
                        className="sm:ml-2"
                        onClick={() => contactUsSubmitBtnRef.current?.click()}
                        disabled={isContactUsModalSubmitting}
                        loading={isContactUsModalSubmitting}
                    />
                    <ButtonFlat
                        text="Close"
                        type={ButtonType.Secondary}
                        onClick={hideContactUsModal}
                    />
                </Footer>
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
