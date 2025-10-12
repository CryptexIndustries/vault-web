const shared = require("@cryptex-industries/shared-ui/tailwind.config.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...shared,
  content: [
    "./src/**/*.{ts,tsx}",
    "../web/src/**/*.{ts,tsx}",
    ...shared.content,
  ],
};