import Head from "next/head";
import NavBar from "../components/index/navbar";
import IndexStyles from "../styles/Index.module.css";

type IndexProps = {};

const index: React.FC<IndexProps> = ({}) => {
    return (
        <>
            <Head>
                <title>Cryptex Vault</title>
                <meta name="description" content="" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <main className={IndexStyles.main}>
                <NavBar />

                <div className={IndexStyles.content}>
                    <section className="h-full">
                        <div className="h-full flex items-center justify-evenly">
                            <div>
                                <h1 className="text-7xl ">
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
                                <img  style={{width:512}} src="/images/logo/Welcome_Banner.png"></img>
                            </div>
                        </div>
                    </section>

                    <section>
                        <p style={{color:"red"}}> Hello workld</p>
                    </section>

                </div>
            </main>
        </>
    );
};

export default index;
