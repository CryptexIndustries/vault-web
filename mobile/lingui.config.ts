import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
    sourceLocale: "en",
    locales: ["en", "hr"],
    fallbackLocales: { default: "en" },
    catalogs: [
        {
            path: "<rootDir>/src/locales/{locale}/messages",
            include: ["<rootDir>/app", "<rootDir>/src"],
            exclude: ["**/node_modules/**", "<rootDir>/src/locales/**"],
        },
    ],
    format: formatter({ lineNumbers: false }),
});
