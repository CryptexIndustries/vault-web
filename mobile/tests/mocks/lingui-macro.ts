// Jest runs ts-jest without Babel, so the Lingui macros never compile. These
// stand-ins render the English source text the macros would produce.
import { createElement, Fragment, type ReactNode } from "react";

type Descriptor = { id?: string; message?: string; comment?: string };
type Choices = Record<string, string>;

function text(
    input: TemplateStringsArray | Descriptor | string,
    values: unknown[],
): string {
    if (typeof input === "string") return input;
    if (!Array.isArray(input)) {
        const descriptor = input as Descriptor;
        return descriptor.message ?? descriptor.id ?? "";
    }
    return input.reduce(
        (result, part, index) =>
            result +
            part +
            (index < values.length ? String(values[index]) : ""),
        "",
    );
}

export function t(
    input: TemplateStringsArray | Descriptor,
    ...values: unknown[]
): string {
    return text(input, values);
}

export function msg(
    input: TemplateStringsArray | Descriptor,
    ...values: unknown[]
): Descriptor {
    const message = text(input, values);
    return { id: message, message };
}

export function plural(value: number, choices: Choices): string {
    const choice =
        choices[`=${value}`] ??
        (value === 1 ? choices.one : undefined) ??
        choices.other ??
        "";
    return choice.replaceAll("#", String(value));
}

export function useLingui() {
    return {
        t,
        i18n: { locale: "en" },
    };
}

export function Trans({ children }: { children?: ReactNode }) {
    return createElement(Fragment, null, children);
}
