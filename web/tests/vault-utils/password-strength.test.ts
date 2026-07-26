import { describe, expect, it } from "@jest/globals";

import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    isBelowOwaspRecommendedArgon2id,
    isWeakPasswordScore,
    PASSWORD_STRENGTH_WEAK_THRESHOLD,
    scorePassword,
} from "@cryptex-industries/vault-core/vault-utils/password-strength";

describe("password-strength", () => {
    it("returns null for empty password", () => {
        expect(scorePassword("")).toBeNull();
    });

    it("flags obvious weak passwords below threshold", () => {
        const result = scorePassword("password");
        expect(result).not.toBeNull();
        expect(result!.score).toBeLessThan(PASSWORD_STRENGTH_WEAK_THRESHOLD);
        expect(isWeakPasswordScore(result!.score)).toBe(true);
    });

    it("detects Argon2id settings below OWASP recommendation", () => {
        expect(
            isBelowOwaspRecommendedArgon2id(
                KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT - 1,
                KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT,
            ),
        ).toBe(true);
        expect(
            isBelowOwaspRecommendedArgon2id(
                KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT,
                KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT - 1,
            ),
        ).toBe(true);
        expect(
            isBelowOwaspRecommendedArgon2id(
                KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT,
                KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT,
            ),
        ).toBe(false);
    });
});
