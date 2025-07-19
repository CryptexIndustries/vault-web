const shared = require("@cryptex-industries/shared-ui/tailwind.config.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
    ...shared,
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",

        ...shared.content,
    ],
};
