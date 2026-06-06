import zxcvbn from "zxcvbn";

import { KeyDerivationConfig_Argon2ID } from "./encryption";

/** Flag passwords weaker than this zxcvbn score (0–4). */
export const PASSWORD_STRENGTH_WEAK_THRESHOLD = 3;

export const PASSWORD_STRENGTH_LABELS = [
    "Very weak",
    "Weak",
    "Fair",
    "Strong",
    "Very strong",
] as const;

export function scorePassword(password: string) {
    if (password.length === 0) {
        return null;
    }
    return zxcvbn(password);
}

export function isWeakPasswordScore(score: number): boolean {
    return score < PASSWORD_STRENGTH_WEAK_THRESHOLD;
}

export function isBelowOwaspRecommendedArgon2id(
    memLimit: number,
    opsLimit: number,
): boolean {
    return (
        memLimit < KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT ||
        opsLimit < KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT
    );
}
