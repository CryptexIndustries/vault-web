import { GetStaticProps, NextPage } from "next";
import Head from "next/head";
import NavBar from "../components/index/navbar";
import IndexStyles from "../styles/Index.module.css";

import { CheckIcon } from "@heroicons/react/24/outline";

type IndexProps = {};

const Index: NextPage<IndexProps> = ({}) => {
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
                    <section className="h-screen">
                        <div className="h-full flex items-center justify-evenly">
                            <div>
                                <h1 className="text-7xl">
                                    We are{" "}
                                    <span className=" text-7xl text-rose-400">
                                        {" "}
                                        Cryptex!
                                    </span>
                                </h1>
                                <p className="pt-5">
                                    Cryptex provides you with the best security
                                    system in the world!
                                </p>
                                <p>The best password manager out there.</p>
                                <div className="mt-10">
                                    <a className="bg-gradient-to-r gradientFromWhiteToPrimary hover:opacity-70 text-white font-bold py-5 px-10 rounded-full transition-opacity mr-7">
                                        Sign In
                                    </a>
                                    <a className="bg-gradient-to-r gradientFromWhiteToPrimary hover:from-pink-500 hover:to-yellow-500 text-white font-bold py-5 px-10 rounded-full transition-opacity">
                                        Log In
                                    </a>
                                </div>
                            </div>
                            <div>
                                <img
                                    style={{ width: 512 }}
                                    src="/images/logo/Welcome_Banner.png"
                                ></img>
                            </div>
                        </div>
                    </section>

                    <section className="h-screen">
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

                    <section className="h-full">
                        <div className="flex w-full justify-center">
                            <h1 className="text-7xl leading-snug">
                                Pricing for all types of <br /> <span className="text-rose-400">companies</span> and <span className="text-rose-400">needs</span>
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
                                                What's included:
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
                                                What's included:
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
                                                    Data Science and Infrastructure
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
