import { type UseFormRegisterReturn } from "react-hook-form";
import { ShowCredentialsGeneratorButton } from "../dialog/credentials-generator";
import React from "react";
import { toast } from "react-toastify";
import {
    ClipboardDocumentIcon,
    EyeIcon,
    EyeSlashIcon,
} from "@heroicons/react/20/solid";
import clsx from "clsx";
import { Input } from "../ui/input";
import { Eye, EyeOff, Shield } from "lucide-react";
import { PasswordGeneratorDialog } from "../ui/password-generator";

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
    options?: string[];
    optionsEnum?: Record<string, string>;
    fullWidth?: boolean;
}> = ({ register, options, optionsEnum, fullWidth }) => {
    return (
        <div
            className={clsx({
                "rounded-sm bg-slate-200 px-3 py-2": true,
                "w-full": fullWidth,
            })}
        >
            <select
                className="w-full truncate bg-slate-200 text-slate-900"
                {...register}
            >
                {
                    // If there is an options array, use that
                    options &&
                        options.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))
                }

                {
                    // If there is an optionsEnum, use that instead
                    optionsEnum &&
                        Object.entries(optionsEnum).map(([key, value]) => (
                            <option key={key} value={key}>
                                {value}
                            </option>
                        ))
                }
            </select>
        </div>
    );
};

type FormInputFieldProps = {
    label: string;
    type?: "text" | "password" | "email" | "tel" | "url";
    placeholder?: string;
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    value?: string | number | readonly string[] | undefined;
    maxLength?: number;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    credentialsGeneratorFnRef?: React.MutableRefObject<() => void>;
    clipboardButton?: boolean;
    additionalButtons?: React.ReactNode;
    darkBackground?: boolean;
};

export const FormInputField: React.FC<
    FormInputFieldProps & {
        register?: UseFormRegisterReturn;
    }
> = ({
    label,
    type = "text",
    placeholder,
    autoCapitalize,
    value,
    maxLength,
    onChange,
    onBlur,
    onKeyDown,
    credentialsGeneratorFnRef,
    clipboardButton = false,
    additionalButtons,
    register,
    darkBackground,
}) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const [realValue, setRealValue] = React.useState(
        value ?? inputRef.current?.value,
    );
    const [valueLength, setValueLength] = React.useState(
        (value as string)?.length ?? 0,
    );

    // Intercept the onChange event and update the valueLength state if maxLength is set
    const _onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (maxLength) {
            setValueLength(e.target.value.length);
        }

        onChange?.(e);
        register?.onChange?.(e);

        setRealValue(e.target.value);
    };

    // Update the valueLength state after first render
    React.useEffect(() => {
        if (maxLength && !value && inputRef?.current) {
            setValueLength(inputRef.current.value.length);
        }
    }, []);

    // In case the inputRef or the value changes, update the realValue state
    // Also, if the control actually changes (the register ref), update the realValue state
    React.useEffect(() => {
        setRealValue(value ?? inputRef.current?.value);
    }, [inputRef, value, register]);

    const inputClassName = clsx({
        "mt-1 w-full rounded-sm bg-slate-200 px-4 py-2 text-slate-900": true,
        // This makes the password field more legible when the password is unmasked
        "font-mono": type === "password" && showPassword,
    });

    const labelClassName = clsx({
        "text-slate-600": !darkBackground,
        "text-slate-400": darkBackground,
    });

    return (
        <>
            {label && <label className={labelClassName}>{label}</label>}
            <div className="flex flex-grow flex-row items-center">
                <input
                    type={showPassword ? "text" : type}
                    className={inputClassName}
                    placeholder={placeholder}
                    autoCapitalize={autoCapitalize}
                    value={value}
                    maxLength={maxLength}
                    autoComplete={type === "password" ? "none" : undefined}
                    onKeyDown={onKeyDown}
                    onBlur={!register ? onBlur : undefined}
                    {...register}
                    ref={(r) => {
                        // Set the inputRef to the current ref
                        inputRef.current = r;

                        // Call the register ref if it exists
                        if (register) {
                            register.ref(r);
                        }
                    }}
                    onChange={_onChange} // Intercept the onChange event - calls the register and the regular onChange callback
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
                        <ClipboardButton value={realValue as string} />
                    </div>
                )}
                {additionalButtons}
            </div>
            {maxLength && (
                <p className="text-slate-600">
                    {valueLength}/{maxLength}
                </p>
            )}
        </>
    );
};

type FormTextAreaFieldProps = FormInputFieldProps & {
    type?: never;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
    credentialsGeneratorFnRef?: never;
    register?: UseFormRegisterReturn;
};
export const FormTextAreaField: React.FC<FormTextAreaFieldProps> = ({
    label,
    placeholder,
    autoCapitalize,
    value,
    onChange,
    onBlur,
    register,
    darkBackground,
}) => {
    const labelClassName = clsx({
        "text-slate-600": !darkBackground,
        "text-slate-400": darkBackground,
    });
    return (
        <>
            {label && <label className={labelClassName}>{label}</label>}
            <textarea
                placeholder={placeholder}
                autoCapitalize={autoCapitalize}
                className="mt-1 max-h-52 min-h-[50px] rounded-sm bg-slate-200 px-4 py-2 text-slate-900"
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                {...register}
            />
        </>
    );
};

type FormNumberInputFieldProps = {
    type?: never;
    autoCapitalize?: never;
    placeholder?: string;
    min?: number;
    max?: number;
    valueLabel?: string;
} & FormInputFieldProps;
/**
 * @obsolete Use FormBaseNumberInputField instead
 */
export const FormNumberInputField: React.FC<
    FormNumberInputFieldProps & {
        register?: UseFormRegisterReturn;
    }
> = ({
    label,
    min,
    max,
    placeholder,
    valueLabel,
    onChange,
    onBlur,
    value,
    register,
}) => {
    return (
        <>
            {label && <label className="text-slate-600">{label}</label>}
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    placeholder={placeholder}
                    onChange={onChange}
                    onBlur={onBlur}
                    value={value}
                    className="w-full border p-2 text-slate-600 transition-all hover:border-slate-500"
                    min={min}
                    max={max}
                    {...register}
                />
                {valueLabel && (
                    <span className="text-md text-slate-600">{valueLabel}</span>
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
            {label && <label className="text-slate-600">{label}</label>}
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    className="w-full border p-2 text-slate-600 transition-all hover:border-slate-500"
                    {...register}
                    min={min}
                    max={max}
                />
                {valueLabel && (
                    <span className="text-md text-slate-600">{valueLabel}</span>
                )}
            </div>
        </>
    );
};

export const FormInputCheckbox: React.FC<{
    label: string;
    valueLabel?: string;
    register: UseFormRegisterReturn;
}> = ({ label, valueLabel, register }) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    // Simulate the click event on the input element
    const onClick = () => inputRef.current?.click();

    return (
        <div className="flex flex-row space-x-4">
            <div className="pt-1">
                <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-slate-600"
                    {...register}
                    ref={(r) => {
                        // Set the inputRef to the current ref
                        inputRef.current = r;

                        // Call the register ref if it exists
                        if (register) {
                            register.ref(r);
                        }
                    }}
                />
            </div>
            <div className="flex flex-col" onClick={onClick}>
                <label className="select-none font-medium text-slate-600">
                    {label}
                </label>
                {valueLabel && (
                    <span className="text-sm text-slate-500">{valueLabel}</span>
                )}
            </div>
        </div>
    );
};

export const FormInput = React.forwardRef<
    HTMLInputElement,
    React.ComponentPropsWithoutRef<"input"> & {
        setValue?: (value: string) => void;
    }
>(({ className, type, onChange, value, setValue, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const [showGeneratorDialog, setShowGeneratorDialog] = React.useState(false);

    const classes = React.useMemo(() => {
        return clsx({
            className: true,
            "font-mono": type === "password" && showPassword,
            "pr-16": type === "password", // Extra padding for two buttons (eye + generator)
        });
    }, [type, className, showPassword]);

    const handlePasswordSelect = (password: string) => {
        if (setValue) {
            // Use setValue if provided (React Hook Form)
            setValue(password);
        } else {
            // Fallback to synthetic event
            const event = {
                target: {
                    value: password,
                },
            } as React.ChangeEvent<HTMLInputElement>;
            onChange?.(event);
        }
    };

    return (
        <>
            <div className="relative">
                <Input
                    className={classes}
                    type={showPassword ? "text" : type}
                    ref={ref}
                    value={value}
                    onChange={onChange}
                    {...props}
                />
                {type === "password" && (
                    <>
                        <button
                            className="absolute right-2 top-2"
                            onClick={() => setShowPassword(!showPassword)}
                            type="button"
                        >
                            {showPassword ? (
                                <EyeOff className="h-5 w-5 text-muted-foreground hover:text-foreground" />
                            ) : (
                                <Eye className="h-5 w-5 text-muted-foreground hover:text-foreground" />
                            )}
                        </button>
                        <button
                            className="absolute right-10 top-2"
                            onClick={() => setShowGeneratorDialog(true)}
                            type="button"
                            title="Generate password"
                        >
                            <Shield className="h-5 w-5 text-muted-foreground hover:text-primary" />
                        </button>
                    </>
                )}
            </div>
            {
                type === "password" && (
                    <PasswordGeneratorDialog
                        open={showGeneratorDialog}
                        onOpenChange={setShowGeneratorDialog}
                        onPasswordSelect={setValue ? handlePasswordSelect : undefined}
                    />
                )
            }
        </>
    );
});
FormInput.displayName = "FormInput";
