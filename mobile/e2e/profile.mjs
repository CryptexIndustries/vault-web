import { createRequire } from "node:module";
const { getProfile } = createRequire(import.meta.url)("../config/profiles.cjs");

export const isIosSimulator = (serial) =>
    /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(serial);

export function e2eIdentity(name = process.env.CRYPTEX_APP_PROFILE) {
    const profile = getProfile(name);
    return {
        CRYPTEX_APP_ID: profile.applicationId,
        CRYPTEX_APP_SCHEME: profile.scheme,
        CRYPTEX_APP_NAME: profile.displayName,
    };
}
export function maestroProfileArgs(name = process.env.CRYPTEX_APP_PROFILE) {
    return Object.entries(e2eIdentity(name)).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
    ]);
}
