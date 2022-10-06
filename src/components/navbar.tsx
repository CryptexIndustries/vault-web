import Link from "next/link";
import Image from "next/image";
import React from "react";

export type NavBarProps = {
    hideLogo?: boolean;
    overrideLogoUrl?: string;
    children?: React.ReactNode;
};

const NavBar: React.FC<NavBarProps> = ({
    hideLogo,
    overrideLogoUrl,
    children,
}) => {
    return (
        <nav className="flex items-center justify-evenly flex-wrap absolute p-6 w-full">
            {!hideLogo ? (
                <div className="flex items-center flex-shrink-0 text-white">
                    <Link href={overrideLogoUrl ?? "/"}>
                        <a>
                            <Image
                                src="/images/logo/cryptex_logo.png"
                                alt="Cryptex Logo"
                                width={200}
                                height={50}
                                className="cursor-pointer"
                            />
                        </a>
                    </Link>
                </div>
            ) : null}
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
            {children}
        </nav>
    );
};

export default NavBar;
