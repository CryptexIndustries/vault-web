// TODO: This doesn't work, so use the relative path to the shared-ui for now
// const shared = require("@cryptex-industries/shared-ui/tailwind.config.cjs");
const shared = require("../packages/shared-ui/tailwind.config.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
    ...shared,
    content: [
        "./src/**/*.{ts,tsx}",
        "../web/src/**/*.{ts,tsx}",
        ...shared.content,
    ],
};
