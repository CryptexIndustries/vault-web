import zxcvbn from "zxcvbn";

export * from "./password-policy";

export function scorePassword(password: string) {
    if (password.length === 0) {
        return null;
    }
    return zxcvbn(password);
}
