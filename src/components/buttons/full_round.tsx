import React from "react";
import { MouseEvent } from "react";

export type FullRoundButtonProps = {
    text: string;
    onClick?: (e: MouseEvent<HTMLAnchorElement, unknown>) => void;
    className?: string;
    disabled?: boolean;
};

export const AnchorFullRoundFade: React.FC<FullRoundButtonProps> = ({
    text,
    onClick,
    className,
    disabled,
}) => {
    const disabledClass = disabled
        ? "bg-gray-800 text-gray-500 cursor-auto"
        : "bg-gradient-to-r gradientFromWhiteToPrimary hover:opacity-70 text-white transition-opacity cursor-pointer";

    const paddingClasses =
        className?.includes("px") ||
        className?.includes("py") ||
        className?.includes("p-")
            ? ""
            : "px-8 py-3";

    return (
        <a
            onClick={(e) => {
                if (!disabled && onClick != null) {
                    onClick(e);
                }
            }}
            className={
                "font-bold rounded-full text-center select-none " +
                disabledClass +
                " " +
                className +
                " " +
                paddingClasses
            }
        >
            {text}
        </a>
    );
};
