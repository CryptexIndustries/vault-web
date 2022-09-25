import { GetStaticProps, NextPage } from "next";
import Head from "next/head";
import NavBar from "../components/index/navbar";
import IndexStyles from "../styles/Index.module.css";

import { CheckIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import Link from "next/link";

const Index: NextPage = ({}) => {
    return (
        <>
            <Head>
                <title>Cryptex Vault</title>
                <meta name="description" content="" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main className="main">
                <NavBar />

                <div className="content">
                    <section id="section-home" className="h-screen">
                        <div className="h-full flex items-center justify-evenly">
                            <div>
                                <h1 className="font-medium text-7xl">
                                    Fully{" "}
                                    <span className="text-7xl text-rose-400">
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
                                    It's your data and nobody should be able to
                                    read it, except <b>you</b>.
                                </p>
                                <br />
                                <p className="ml-2 text-gray-300">
                                    That's why we built{" "}
                                    <b className="text-rose-400">
                                        Cryptex Vault
                                    </b>
                                    .
                                </p>
                                <p className="ml-2 text-gray-300">
                                    We can't even know what you store in your
                                    vault. Your data does not touch our servers.
                                </p>
                                <p className="ml-2 text-gray-300">
                                    Our job is to make sure your devices are
                                    connected and synchronized. That's it.
                                </p>
                                <div className="mt-20">
                                    <Link href={"/login"}>
                                        <a className="bg-gradient-to-r gradientFromWhiteToPrimary hover:opacity-70 text-white font-bold py-5 px-10 rounded-full transition-opacity mr-7">
                                            Start Now!
                                        </a>
                                    </Link>
                                </div>
                            </div>
                            <div>
                                <Image
                                    width={512}
                                    height={512}
                                    priority={true}
                                    src="/images/logo/Welcome_Banner.png"
                                ></Image>
                            </div>
                        </div>
                    </section>

                    <section id="section-about" className="h-screen">
                        <div className="h-full flex items-center justify-evenly">
                            <div className="max-w-lg">
                                <h1 className="text-3xl">
                                    We started as a drajen mušketiren wit no
                                    mani.We started as a drajen mušketiren wit
                                    no mani.We started as a drajen mušketiren
                                    wit no mani.We started as a drajen
                                    mušketiren wit no mani.We started as a
                                    drajen mušketiren wit no mani.We started as
                                    a drajen mušketiren wit no mani.We started
                                    as a drajen mušketiren wit no mani.We
                                    started as a drajen mušketiren wit no
                                    mani.We started as a drajen mušketiren wit
                                    no mani.
                                </h1>
                            </div>

                            <div className="max-w-lg">
                                <p>
                                    MIHA JE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaJE
                                    GEYYYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
                                </p>
                            </div>
                        </div>
                    </section>

                    <section id="section-pricing" className="h-full">
                        <div className="flex w-full justify-center">
                            <h1 className="text-7xl leading-snug">
                                Pricing for all types of <br />{" "}
                                <span className="text-rose-400">companies</span>{" "}
                                and <span className="text-rose-400">needs</span>
                            </h1>
                        </div>

                        <div className="flex w-full justify-center mt-10 space-x-4 pb-14">
                            <div className={IndexStyles.pricingCard}>
                                <div className="flex flex-col max-w-md px-10 py-16">
                                    <div className="mb-4">
                                        <h2 className="font-bold text-lg text-gray-400">
                                            Standard
                                        </h2>
                                        <div className="text-3xl font-bold">
                                            €5,000 EUR
                                        </div>
                                    </div>

                                    <p className="text-lg text-gray-300 mb-10">
                                        A plan created for small developments
                                        tasks and simple feature additions.
                                    </p>

                                    <a className="bg-gray-700 hover:opacity-70 text-white font-bold py-5 px-10 rounded-full transition-opacity mr-7 w-full text-center">
                                        Get started
                                    </a>
                                    <div className="mt-12">
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
                                                    200 Hours of Development
                                                    Time
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Extra hours at $50/hr
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Frontend and Backend only
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Normal Support
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className={IndexStyles.pricingCard}>
                                <div className="flex flex-col max-w-md px-10 py-16">
                                    <div className="mb-4">
                                        <h2 className="font-bold text-lg text-gray-400">
                                            Premium
                                        </h2>
                                        <div className="text-3xl font-bold">
                                            €10,000 EUR
                                        </div>
                                    </div>

                                    <p className="text-lg text-gray-300 mb-10">
                                        A plan created for small developments
                                        tasks and simple feature additions.
                                    </p>

                                    <a className="bg-gradient-to-r gradientFromWhiteToPrimary hover:opacity-70 text-white font-bold py-5 px-10 rounded-full transition-opacity mr-7 w-full text-center">
                                        Get started
                                    </a>
                                    <div className="mt-12">
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
                                                    500 Hours of Development
                                                    Time
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Extra hours at $45/hr
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Data Science and
                                                    Infrastructure
                                                </div>
                                            </div>
                                            <div className="flex">
                                                <div className="mr-3.5 text-2xl">
                                                    <CheckIcon className="h-6 w-6 text-rose-400" />
                                                </div>
                                                <div className="text-gray-200">
                                                    Dedicated Support
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </>
    );
};

export const getStaticProps: GetStaticProps = async () => {
    return {
        props: {},
    };
};

export default Index;
