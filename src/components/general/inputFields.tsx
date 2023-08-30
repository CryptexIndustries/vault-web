import { type UseFormRegisterReturn } from "react-hook-form";
import { ShowCredentialsGeneratorButton } from "../dialog/credentialsGenerator";
import React from "react";
import { toast } from "react-toastify";
import {
    ClipboardDocumentIcon,
    EyeIcon,
    EyeSlashIcon,
} from "@heroicons/react/20/solid";

export const ClipboardButton = ({ value }: { value?: string }) => {
    const saveToClipboard = async (value?: string) => {
        if (!value) return;
        await navigator.clipboard.writeText(value);
        toast.info("Copied to clipboard");
    };

    return (
        <ClipboardDocumentIcon
            className="mx-2 h-5 w-5 flex-grow-0 cursor-pointer text-slate-400 hover:text-slate-500"
            style={{
                // display: value ? "block" : "none",
                // If the value is empty, set opacity to 50%
                opacity: value ? 1 : 0.5,
                pointerEvents: value ? "auto" : "none",
            }}
            aria-hidden="true"
            title="Copy to clipboard"
            onClick={() => saveToClipboard(value)}
        />
    );
};

export const FormSelectboxField: React.FC<{
    register: UseFormRegisterReturn;
    options: string[];
}> = ({ register, options }) => {
    return (
        <div className="mt-1 rounded-md bg-gray-200 px-3 py-2">
            <select
                className="w-full truncate bg-gray-200 text-gray-900"
                {...register}
            >
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </div>
    );
};

type FormInputFieldProps = {
    label: string;
    type?: "text" | "password" | "email" | "tel" | "url";
    placeholder?: string;
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    value: string | number | readonly string[] | undefined;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    credentialsGeneratorFnRef?: React.MutableRefObject<() => void>;
    clipboardButton?: boolean;
    additionalButtons?: React.ReactNode;
};

export const FormInputField: React.FC<FormInputFieldProps> = ({
    label,
    type = "text",
    placeholder,
    autoCapitalize,
    value,
    onChange,
    onBlur,
    onKeyDown,
    credentialsGeneratorFnRef,
    clipboardButton = false,
    additionalButtons,
}) => {
    const [showPassword, setShowPassword] = React.useState(false);

    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <div className="flex flex-grow flex-row items-center">
                <input
                    type={showPassword ? "text" : type}
                    placeholder={placeholder}
                    autoCapitalize={autoCapitalize}
                    className="mt-1 w-full rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                    onKeyDown={onKeyDown}
                    onChange={onChange}
                    onBlur={onBlur}
                    value={value}
                    autoComplete={type === "password" ? "none" : undefined}
                />
                {type === "password" && (
                    <button
                        className="mx-2"
                        onClick={() => setShowPassword(!showPassword)}
                    >
                        {showPassword ? (
                            <EyeSlashIcon className="h-5 w-5 text-slate-400 hover:text-slate-500" />
                        ) : (
                            <EyeIcon className="h-5 w-5 text-slate-400 hover:text-slate-500" />
                        )}
                    </button>
                )}
                {credentialsGeneratorFnRef && (
                    <div>
                        <ShowCredentialsGeneratorButton
                            fnRef={credentialsGeneratorFnRef}
                        />
                    </div>
                )}
                {clipboardButton && (
                    <div>
                        <ClipboardButton value={value as string} />
                    </div>
                )}
                {additionalButtons}
            </div>
        </>
    );
};

type FormTextAreaFieldProps = FormInputFieldProps & {
    type?: never;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
    credentialsGeneratorFnRef?: never;
};
export const FormTextAreaField: React.FC<FormTextAreaFieldProps> = ({
    label,
    placeholder,
    autoCapitalize,
    value,
    onChange,
    onBlur,
}) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <textarea
                placeholder={placeholder}
                autoCapitalize={autoCapitalize}
                className="mt-1 max-h-52 min-h-[50px] rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            />
        </>
    );
};

type FormNumberInputFieldProps = {
    type?: never;
    autoCapitalize?: never;
    placeholder?: never;
    min?: number;
    max?: number;
    valueLabel?: string;
} & FormInputFieldProps;
/**
 * @obsolete Use FormBaseNumberInputField instead
 */
export const FormNumberInputField: React.FC<FormNumberInputFieldProps> = ({
    label,
    min,
    max,
    valueLabel,
    onChange,
    onBlur,
    value,
}) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    onChange={onChange}
                    onBlur={onBlur}
                    value={value}
                    className="w-full border p-2 transition-all hover:border-slate-500"
                    min={min}
                    max={max}
                />
                {valueLabel && (
                    <span className="text-md text-gray-600">{valueLabel}</span>
                )}
            </div>
        </>
    );
};

export const FormBaseNumberInputField: React.FC<{
    label?: string;
    valueLabel?: string;
    register: UseFormRegisterReturn;
    min?: number;
    max?: number;
}> = ({ label, valueLabel, register, min, max }) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    className="w-full border p-2 transition-all hover:border-slate-500"
                    {...register}
                    min={min}
                    max={max}
                />
                {valueLabel && (
                    <span className="text-md text-gray-600">{valueLabel}</span>
                )}
            </div>
        </>
    );
};
