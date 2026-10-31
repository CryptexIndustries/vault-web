// Hermes has no Intl.PluralRules, which Lingui needs for plural messages.
import "@formatjs/intl-pluralrules/polyfill-force.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/hr.js";
import { i18n } from "@lingui/core";
import { getLocales } from "expo-localization";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import { messages as en } from "@/locales/en/messages.po";
import { messages as hr } from "@/locales/hr/messages.po";

/** Each app language, named in that language. */
export const APP_LOCALES = { en: "English", hr: "Hrvatski" } as const;
export type AppLocale = keyof typeof APP_LOCALES;

type AppLocaleModule = {
    getAppLocale(): string | null;
    setAppLocale(tag: string | null): Promise<void>;
};

const native =
    Platform.OS === "android"
        ? requireOptionalNativeModule<AppLocaleModule>("CryptexAppLocale")
        : null;

/** Whether the app can keep its own language apart from the device's. */
export const appLocaleChoiceAvailable = native != null;

/** The first supported language among the given tags, else English. */
export function matchAppLocale(
    tags: readonly (string | null | undefined)[],
): AppLocale {
    for (const tag of tags) {
        const language = tag?.split(/[-_]/)[0]?.toLowerCase();
        if (language && Object.hasOwn(APP_LOCALES, language))
            return language as AppLocale;
    }
    return "en";
}

// One value for every picker; refreshed on each activation.
let chosenTag: string | null = null;

/** The language picked in the app, or null while it follows the device. */
export function getChosenAppLocale(): AppLocale | null {
    return chosenTag ? matchAppLocale([chosenTag]) : null;
}

/** Activates the chosen language, else the device's first supported one. */
export function activateAppLocale(
    chosen: string | null | undefined = native?.getAppLocale(),
): void {
    chosenTag = chosen ?? null;
    const locale = matchAppLocale([
        chosen,
        ...getLocales().map((locale) => locale.languageTag),
    ]);
    if (i18n.locale !== locale) i18n.activate(locale);
}

/** Saves the language choice; null follows the device again. */
export async function chooseAppLocale(locale: AppLocale | null): Promise<void> {
    activateAppLocale(locale);
    await native?.setAppLocale(locale);
}

i18n.load({ en, hr });
activateAppLocale();
