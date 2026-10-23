const shared = require("@cryptex-industries/shared-ui/tailwind.config.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
    ...shared,
    theme: {
        ...shared.theme,
        extend: {
            ...shared.theme.extend,
            colors: Object.assign({}, shared.theme.extend.colors, {
                // Connected agent glyphs only, never buttons (as on Android).
                agent: "hsl(var(--agent))",
            }),
        },
    },
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",

        ...shared.content,
    ],
};
