// CRYPTEX_BROWSER picks the browser a build is for. Chromium builds go to
// dist/ and Firefox builds to dist-firefox/, so both can sit side by side.
export function browserTarget(): "chromium" | "firefox" {
    const value = process.env.CRYPTEX_BROWSER || "chromium";
    if (value !== "chromium" && value !== "firefox") {
        throw new Error(
            `Unknown CRYPTEX_BROWSER: ${value}. Use chromium or firefox.`,
        );
    }
    return value;
}

export const outDir = (): string =>
    browserTarget() === "firefox" ? "dist-firefox" : "dist";
