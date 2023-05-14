import { clsx } from "clsx";
import React from "react";
import { MouseEvent } from "react";
import Spinner from "./spinner";

// TODO: Mixed up secondary and tertiary, fix this
export enum ButtonType {
    Primary = "bg-colorPrimary focus:ring-red-500 text-white hover:opacity-80 border-transparent",
    PrimaryOutline = "",
    Secondary = "focus:ring-indigo-500 text-gray-700 hover:opacity-80 border border-gray-300",
    Tertiary = "colorPrimary hover:opacity-80 border-none",
    Flat = "rounded-md bg-rose-400 p-2 font-bold transition-opacity hover:opacity-70 border-none",
    Fade = "bg-gradient-to-r gradientFromWhiteToPrimary text-white hover:opacity-80 transition-opacity cursor-pointer",
    FadeGreen = "bg-gradient-to-r gradientFromWhiteToGreen text-white hover:opacity-80 transition-opacity cursor-pointer",
}

export type FullRoundButtonProps = {
    text: string;
    type?: ButtonType;
    onClick?: (e: MouseEvent<HTMLButtonElement, unknown>) => void;
    className?: string;
    disabled?: boolean;
};
export const AnchorFullRoundFade: React.FC<FullRoundButtonProps> = ({
    text,
    type = ButtonType.Fade,
    onClick,
    className,
    disabled,
}) => {
    const disabledClass = clsx({
        "bg-gray-800 text-gray-500 cursor-auto": disabled,
        [type]: !disabled,
    });

    const paddingClasses = clsx({
        "px-8 py-3":
            !className?.includes("px-") &&
            !className?.includes("py-") &&
            !className?.includes("p-"),
    });

    return (
        <button
            onClick={(e) => {
                if (!disabled && onClick != null) {
                    onClick(e);
                }
            }}
            className={clsx({
                "select-none rounded-full text-center font-bold": true,
                [disabledClass]: true,
                [className ?? ""]: true,
                [paddingClasses]: true,
            })}
        >
            {text}
        </button>
    );
};

export type ButtonFlatProps = {
    text: string;
    type?: ButtonType;
    onClick?: (e: MouseEvent) => void;
    className?: string;
    inhibitAutoWidth?: boolean;
    disabled?: boolean;
    loading?: boolean;
};
export const ButtonFlat: React.FC<ButtonFlatProps> = ({
    text,
    type = ButtonType.Primary,
    onClick,
    className,
    inhibitAutoWidth,
    disabled,
    loading,
}) => {
    const disabledClass = clsx({
        "bg-gray-600 text-gray-400 cursor-auto": disabled,
        [type]: !disabled,
    });

    const paddingClasses = clsx({
        "px-4 py-2":
            !className?.includes("px-") &&
            !className?.includes("py-") &&
            !className?.includes("p-"),
    });

    return (
        <button
            type="button"
            className={clsx({
                "inline-flex justify-center rounded-md border text-base font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 sm:text-sm":
                    true,
                "w-full sm:w-auto": !inhibitAutoWidth,
                [paddingClasses]: true,
                [disabledClass]: true,
                [className ?? ""]: true,
            })}
            onClick={onClick}
            disabled={disabled}
        >
            {loading ? <Spinner size={5} /> : [text]}
        </button>
    );
};
