import { describe, expect, it } from "@jest/globals";
// SSH key descriptions need TextDecoder.
import "../helpers/jsdom-encoding";
import { sshPublicKey } from "../helpers/ssh-fixtures";

import { ItemType } from "@cryptex-industries/vault-core/proto";
import {
    PASSWORD_AGE_REVIEW_DAYS,
    analyzeCredentialSecurity,
    type SecurityReportCredential,
} from "@cryptex-industries/vault-core/vault-utils/security-report";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 19);

function credential(
    overrides: Partial<SecurityReportCredential> = {},
): SecurityReportCredential {
    return {
        ID: "credential-1",
        Type: ItemType.Credentials,
        Name: "Example",
        Username: "person@example.com",
        Password: "correct horse battery staple",
        URL: "https://example.com/login",
        DatePasswordChangedTimestamp: NOW,
        Deleted: false,
        ...overrides,
    };
}

describe("analyzeCredentialSecurity", () => {
    it("analyzes only active credential items with a non-empty password", () => {
        const result = analyzeCredentialSecurity(
            [
                credential(),
                credential({ ID: "deleted", Deleted: true }),
                credential({ ID: "note", Type: ItemType.Note }),
                credential({ ID: "empty", Password: "" }),
            ],
            NOW,
        );

        expect(result.analyzedCount).toBe(1);
        expect(result.healthBand).toBe("good");
    });

    it("groups exact case-sensitive password reuse without exposing passwords", () => {
        const result = analyzeCredentialSecurity(
            [
                credential({ ID: "a", Password: "password" }),
                credential({ ID: "b", Password: "password" }),
                credential({ ID: "c", Password: "Password" }),
            ],
            NOW,
        );

        expect(result.reuseGroups).toHaveLength(1);
        expect(
            result.reuseGroups[0]?.credentials.map(
                (finding) => finding.credentialId,
            ),
        ).toEqual(["a", "b"]);
        expect(
            result.weakFindings.map((finding) => finding.credentialId),
        ).toEqual(expect.arrayContaining(["a", "b"]));
        expect(JSON.stringify(result)).not.toContain("password");
        expect(JSON.stringify(result)).not.toContain("Password");
    });

    it("maps zxcvbn scores 0-1 to critical and score 2 to warning", () => {
        const result = analyzeCredentialSecurity(
            [
                credential({ ID: "score-0", Password: "12345" }),
                credential({
                    ID: "score-2",
                    Password: "Tr0ub4dour&3",
                }),
            ],
            NOW,
        );

        const scoreZero = result.weakFindings.find(
            (finding) => finding.credentialId === "score-0",
        );
        const scoreTwo = result.weakFindings.find(
            (finding) => finding.credentialId === "score-2",
        );
        expect(scoreZero?.score).toBeLessThanOrEqual(1);
        expect(scoreZero?.severity).toBe("critical");
        expect(scoreTwo?.score).toBe(2);
        expect(scoreTwo?.severity).toBe("warning");
    });

    it("derives all three health bands", () => {
        expect(
            analyzeCredentialSecurity([credential({ Password: "12345" })], NOW)
                .healthBand,
        ).toBe("at-risk");
        expect(
            analyzeCredentialSecurity(
                [
                    credential({ ID: "reused-a" }),
                    credential({ ID: "reused-b" }),
                ],
                NOW,
            ).healthBand,
        ).toBe("at-risk");
        expect(
            analyzeCredentialSecurity(
                [credential({ Password: "Tr0ub4dour&3" })],
                NOW,
            ).healthBand,
        ).toBe("needs-attention");
        expect(
            analyzeCredentialSecurity(
                [credential({ Password: "correct horse battery staple" })],
                NOW,
            ).healthBand,
        ).toBe("good");
    });

    it("uses the fixed 365-day boundary and ignores invalid or future timestamps", () => {
        const result = analyzeCredentialSecurity(
            [
                credential({
                    ID: "boundary",
                    DatePasswordChangedTimestamp:
                        NOW - PASSWORD_AGE_REVIEW_DAYS * DAY,
                }),
                credential({
                    ID: "under-boundary",
                    DatePasswordChangedTimestamp:
                        NOW - PASSWORD_AGE_REVIEW_DAYS * DAY + 1,
                }),
                credential({
                    ID: "missing",
                    DatePasswordChangedTimestamp: 0,
                }),
                credential({
                    ID: "invalid",
                    DatePasswordChangedTimestamp: Number.NaN,
                }),
                credential({
                    ID: "future",
                    DatePasswordChangedTimestamp: NOW + 1,
                }),
            ],
            NOW,
        );

        expect(result.ageFindings).toHaveLength(1);
        expect(result.ageFindings[0]).toMatchObject({
            credentialId: "boundary",
            passwordAgeDays: 365,
        });
    });

    it("never lets password age affect health", () => {
        const result = analyzeCredentialSecurity(
            [
                credential({
                    Password: "correct horse battery staple",
                    DatePasswordChangedTimestamp: NOW - 1000 * DAY,
                }),
            ],
            NOW,
        );

        expect(result.ageFindings).toHaveLength(1);
        expect(result.healthBand).toBe("good");
    });

    it("reports analysis progress without including credential data", () => {
        const progress: Array<{ processed: number; total: number }> = [];

        analyzeCredentialSecurity(
            [credential({ ID: "a" }), credential({ ID: "b" })],
            NOW,
            (update) => progress.push(update),
        );

        expect(progress).toEqual([
            { processed: 0, total: 2 },
            { processed: 1, total: 2 },
            { processed: 2, total: 2 },
        ]);
        expect(Object.keys(progress[0] ?? {})).toEqual(["processed", "total"]);
    });

    it("handles empty and large mixed vaults", () => {
        expect(analyzeCredentialSecurity([], NOW)).toEqual({
            healthBand: "good",
            analyzedCount: 0,
            weakFindings: [],
            reuseGroups: [],
            ageFindings: [],
            weakSSHKeyFindings: [],
        });

        const mixedVault = Array.from({ length: 500 }, (_, index) =>
            credential({
                ID: `credential-${index}`,
                Password:
                    index % 25 === 0
                        ? "shared weak password"
                        : `unique-${index}-correct-horse-battery-staple`,
                Deleted: index % 40 === 0,
            }),
        );
        const result = analyzeCredentialSecurity(mixedVault, NOW);

        expect(result.analyzedCount).toBe(487);
        expect(result.reuseGroups).toHaveLength(1);
        expect(result.healthBand).toBe("at-risk");
    });

    describe("SSH keys", () => {
        const sshKey = (id: string, fixture: string) =>
            credential({
                ID: id,
                Name: id,
                Type: ItemType.SSHKey,
                Username: "",
                Password: "",
                URL: "",
                SSHKey: {
                    PrivateKey: "",
                    PublicKey: sshPublicKey(fixture),
                    Comment: "",
                },
            });

        it("flags RSA keys under 3072 bits and skips password checks", () => {
            const result = analyzeCredentialSecurity(
                [
                    sshKey("rsa-1024", "rsa-1024.key"),
                    sshKey("rsa-2048", "rsa-pkcs8.key"),
                    sshKey("rsa-3072", "rsa-3072.key"),
                    sshKey("ed25519", "ed25519.key"),
                ],
                NOW,
            );

            expect(result.analyzedCount).toBe(4);
            expect(result.weakFindings).toEqual([]);
            expect(
                result.weakSSHKeyFindings.map(
                    ({ credentialId, keyLabel, severity }) => ({
                        credentialId,
                        keyLabel,
                        severity,
                    }),
                ),
            ).toEqual([
                {
                    credentialId: "rsa-1024",
                    keyLabel: "RSA 1024",
                    severity: "critical",
                },
                {
                    credentialId: "rsa-2048",
                    keyLabel: "RSA 2048",
                    severity: "warning",
                },
            ]);
            expect(result.healthBand).toBe("at-risk");
        });

        it("treats a 2048-bit RSA key as needing attention", () => {
            const result = analyzeCredentialSecurity(
                [sshKey("rsa-2048", "rsa-pkcs8.key")],
                NOW,
            );
            expect(result.healthBand).toBe("needs-attention");
        });
    });
});
