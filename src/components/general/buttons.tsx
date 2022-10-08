import React from "react";
import { MouseEvent } from "react";
import Spinner from "./spinner";

export enum ButtonType {
    Primary = "bg-colorPrimary focus:ring-red-500 text-white hover:opacity-80 border-transparent",
    Secondary = "bg-white focus:ring-indigo-500 text-gray-700 hover:bg-gray-50 border border-gray-300",
    PrimaryOutline = "",
    Fade = "bg-gradient-to-r gradientFromWhiteToPrimary text-white hover:opacity-80 transition-opacity cursor-pointer",
}

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
        : ButtonType.Fade;

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
                "font-bold rounded-full text-center select-none" +
                " " +
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

export type ButtonFlatProps = {
    text: string;
    type?: ButtonType;
    onClick?: (e: MouseEvent) => void;
    className?: string;
    disabled?: boolean;
    loading?: boolean;
};

export const ButtonFlat: React.FC<ButtonFlatProps> = ({
    text,
    type = ButtonType.Primary,
    onClick,
    className,
    disabled,
    loading,
}) => {
    const disabledClass = disabled
        ? "bg-gray-600 text-gray-400 cursor-auto"
        : type;

    const paddingClasses =
        className?.includes("px-") ||
        className?.includes("py-") ||
        className?.includes("p-")
            ? ""
            : "px-4 py-2";

    return (
        <button
            type="button"
            className={
                "inline-flex w-full justify-center rounded-md border text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm font-medium" +
                " " +
                paddingClasses +
                " " +
                disabledClass +
                " " +
                className
            }
            onClick={onClick}
            disabled={disabled}
        >
            {loading ? <Spinner size={5} /> : [text]}
        </button>
    );
};
