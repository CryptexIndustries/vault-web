import Link from "next/link";

export type NavBarProps = {};

const NavBar: React.FC<NavBarProps> = ({}) => {
    return (
        <nav className="flex items-center justify-evenly flex-wrap absolute p-6 w-screen h">
            <div className="flex items-center flex-shrink-0 text-white mr-6">
                <img src="/images/logo/cryptex_logo.svg" style={{height:60, width:120}} ></img>
                {/* <span className="font-semibold text-xl tracking-tight">
                    Cryptex Vault
                </span> */}
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

            <div className="text-lg">
                <a
                    href="#responsive-header"
                    className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 mr-4"
                >
                    Home
                </a>
                <a
                    href="#responsive-header"
                    className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 transition-colors mr-4"
                >
                    Pricing
                </a>
                <a
                    href="#responsive-header"
                    className="block mt-4 lg:inline-block lg:mt-0 text-white hover:text-rose-400 transition-colors"
                >
                    About
                </a>
            </div>
            <div>
                <Link href={"/login"}>
                    <a className="bg-gradient-to-r gradientFromGreenToPrimary hover:opacity-70 text-white font-bold py-3 px-8 rounded-full transition-opacity ">
                    Sign In
                    </a>
                </Link>
            </div>
        </nav>
    );
};

export default NavBar;
