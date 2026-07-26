import { ItemType, type Credential } from "../proto/vault";
import { normalizeCredentialUrl } from "../credential-url";
import { PASSWORD_STRENGTH_LABELS, scorePassword } from "./password-strength";

export const PASSWORD_AGE_REVIEW_DAYS = 365;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export type SecurityHealthBand = "at-risk" | "needs-attention" | "good";

export type SecurityFindingIdentity = {
    credentialId: string;
    name: string;
    username?: string;
    domain?: string;
};

export type WeakPasswordFinding = SecurityFindingIdentity & {
    score: 0 | 1 | 2;
    strengthLabel: string;
    severity: "critical" | "warning";
};

export type ReusedPasswordGroup = {
    credentials: SecurityFindingIdentity[];
};

export type PasswordAgeFinding = SecurityFindingIdentity & {
    passwordAgeDays: number;
};

export type SecurityAnalysisResult = {
    healthBand: SecurityHealthBand;
    analyzedCount: number;
    weakFindings: WeakPasswordFinding[];
    reuseGroups: ReusedPasswordGroup[];
    ageFindings: PasswordAgeFinding[];
};

export type SecurityAnalysisProgress = {
    processed: number;
    total: number;
};

export type SecurityReportCredential = Pick<
    Credential,
    | "ID"
    | "Type"
    | "Name"
    | "Username"
    | "Password"
    | "URL"
    | "DatePasswordChangedTimestamp"
    | "Deleted"
>;

function getCredentialDomain(rawUrl: string): string | undefined {
    const normalizedUrl = normalizeCredentialUrl(rawUrl);
    if (!normalizedUrl) return undefined;

    try {
        return new URL(normalizedUrl).hostname || undefined;
    } catch {
        return undefined;
    }
}

function toFindingIdentity(
    credential: SecurityReportCredential,
): SecurityFindingIdentity {
    const domain = getCredentialDomain(credential.URL);

    return {
        credentialId: credential.ID,
        name: credential.Name,
        ...(credential.Username ? { username: credential.Username } : {}),
        ...(domain ? { domain } : {}),
    };
}

function getPasswordAgeDays(timestamp: number, now: number): number | null {
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) {
        return null;
    }

    return Math.floor((now - timestamp) / DAY_IN_MILLISECONDS);
}

export function* iterateCredentialSecurityAnalysis(
    credentials: readonly SecurityReportCredential[],
    now = Date.now(),
): Generator<SecurityAnalysisProgress, SecurityAnalysisResult> {
    const activeCredentials = credentials.filter(
        (credential) =>
            !credential.Deleted &&
            credential.Type === ItemType.Credentials &&
            credential.Password.length > 0,
    );

    const passwordGroups = new Map<string, SecurityFindingIdentity[]>();
    const weakFindings: WeakPasswordFinding[] = [];
    const ageFindings: PasswordAgeFinding[] = [];

    yield { processed: 0, total: activeCredentials.length };

    for (const [index, credential] of activeCredentials.entries()) {
        const identity = toFindingIdentity(credential);
        const passwordGroup = passwordGroups.get(credential.Password);
        if (passwordGroup) {
            passwordGroup.push(identity);
        } else {
            passwordGroups.set(credential.Password, [identity]);
        }

        const strength = scorePassword(credential.Password);
        if (strength && strength.score <= 2) {
            const score = strength.score as 0 | 1 | 2;
            weakFindings.push({
                ...identity,
                score,
                strengthLabel: PASSWORD_STRENGTH_LABELS[score],
                severity: score <= 1 ? "critical" : "warning",
            });
        }

        const passwordAgeDays = getPasswordAgeDays(
            credential.DatePasswordChangedTimestamp,
            now,
        );
        if (
            passwordAgeDays !== null &&
            passwordAgeDays >= PASSWORD_AGE_REVIEW_DAYS
        ) {
            ageFindings.push({ ...identity, passwordAgeDays });
        }

        yield {
            processed: index + 1,
            total: activeCredentials.length,
        };
    }

    const reuseGroups = Array.from(passwordGroups.values())
        .filter((group) => group.length > 1)
        .map((group) => ({
            credentials: group,
        }));

    weakFindings.sort((a, b) => a.score - b.score);
    ageFindings.sort((a, b) => b.passwordAgeDays - a.passwordAgeDays);

    const hasCriticalWeakPassword = weakFindings.some(
        (finding) => finding.severity === "critical",
    );
    const healthBand: SecurityHealthBand =
        reuseGroups.length > 0 || hasCriticalWeakPassword
            ? "at-risk"
            : weakFindings.length > 0
              ? "needs-attention"
              : "good";

    return {
        healthBand,
        analyzedCount: activeCredentials.length,
        weakFindings,
        reuseGroups,
        ageFindings,
    };
}

/**
 * Analyzes credential passwords locally. The returned model deliberately omits
 * passwords and password-derived identifiers so it is safe to hand to the UI.
 */
export function analyzeCredentialSecurity(
    credentials: readonly SecurityReportCredential[],
    now = Date.now(),
    onProgress?: (progress: SecurityAnalysisProgress) => void,
): SecurityAnalysisResult {
    const analysis = iterateCredentialSecurityAnalysis(credentials, now);
    let step = analysis.next();

    while (!step.done) {
        onProgress?.(step.value);
        step = analysis.next();
    }

    return step.value;
}
