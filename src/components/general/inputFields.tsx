import { type UseFormRegisterReturn } from "react-hook-form";

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
};
export const FormInputField: React.FC<FormInputFieldProps> = ({
    label,
    type = "text",
    placeholder,
    autoCapitalize,
    value,
    onChange,
    onBlur,
}) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <input
                type={type}
                placeholder={placeholder}
                autoCapitalize={autoCapitalize}
                className="mt-1 rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            />
        </>
    );
};

type FormTextAreaFieldProps = {
    type?: never;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
} & FormInputFieldProps;
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
