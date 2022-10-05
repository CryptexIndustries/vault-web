import Link from "next/link";
import Image from "next/image";

export type NavBarProps = {
    linksShown?: boolean;
};

const NavBar: React.FC<NavBarProps> = ({ linksShown }) => {
    return (
        <nav className="flex items-center justify-evenly flex-wrap absolute p-6 w-full">
            <div className="flex items-center flex-shrink-0 text-white">
                <Image
                    src="/images/logo/cryptex_logo.png"
                    alt="Cryptex Logo"
                    width={200}
                    height={50}
                />
            </div>
            <div className="block lg:hidden">
                <button className="flex items-center px-3 py-2 border rounded text-teal-200 border-teal-400 hover:text-white hover:border-white">
                    <svg
                        className="fill-current h-3 w-3"
                        viewBox="0 0 20 20"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <title>Menu</title>
                        <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
                    </svg>
                </button>
            </div>

            {linksShown ? (
                <div className="text-lg">
                    <a
                        href="#section-home"
                        className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 mr-4"
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
            ) : null}
            <div>
                <Link href={"/login"}>
                    <a className="bg-gradient-to-r gradientFromWhiteToPrimary hover:opacity-70 text-white font-bold py-3 px-8 rounded-full transition-opacity ">
                        Sign In
                    </a>
                </Link>
            </div>
        </nav>
    );
};

export default NavBar;
