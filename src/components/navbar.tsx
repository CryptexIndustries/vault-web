import Link from "next/link";
import Image from "next/image";
import React from "react";
import clsx from "clsx";

export type NavBarProps = {
    /**
     * If this is set to true, the logo will not be displayed.
     */
    hideLogo?: boolean;

    /**
     * If this is not set, the logo will have act as a link to the home page.
     * If this is set to null or an empty string, the logo will not be clickable.
     */
    overrideLogoUrl?: string | null;

    /**
     * The class name of the navbar.
     * @default "flex w-full flex-wrap items-center justify-evenly p-6"
     */
    className?: string;

    /**
     * The class name of the logo container.
     * @default "flex flex-shrink-0 items-center text-white"
     */
    logoContainerClassName?: string;

    /**
     * The children of the navbar.
     */
    children?: React.ReactNode;
};

const NavBar: React.FC<NavBarProps> = ({
    hideLogo,
    overrideLogoUrl,
    className,
    logoContainerClassName,
    children,
}) => {
    // If the overrideLogoUrl is undefined or has a length, then it is clickable, otherwise it is static
    const withLink = overrideLogoUrl === undefined || overrideLogoUrl?.length;

    const navClasses = clsx({
        "flex w-full flex-wrap items-center p-6": true,
        [className ?? ""]: className !== undefined,
        "justify-evenly": !className?.includes("justify"),
    });

    const logoContainerClasses = clsx({
        "flex flex-shrink-0 items-center text-white": true,
        [logoContainerClassName ?? ""]: logoContainerClassName !== undefined,
    });

    return (
        <nav className={navClasses}>
            {!hideLogo && (
                <div className={logoContainerClasses}>
                    {withLink && (
                        <Link href={overrideLogoUrl ?? "/"}>
                            {/* FIXME: This anchor tag adds ~7px to the bottom */}
                            <Image
                                src="/images/logo/cryptex_logo.svg"
                                alt="Cryptex Logo"
                                width={200}
                                height={50}
                                priority={true}
                                className="cursor-pointer select-none"
                            />
                        </Link>
                    )}
                    {!withLink && (
                        <Image
                            src="/images/logo/cryptex_logo.svg"
                            alt="Cryptex Logo"
                            width={200}
                            height={50}
                            priority={true}
                            className="select-none"
                        />
                    )}
                </div>
            )}
            {/* <div className="block lg:hidden">
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
            </div> */}
            {children}
        </nav>
    );
};

export default NavBar;
