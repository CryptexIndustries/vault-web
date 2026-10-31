import { t } from "@lingui/core/macro";
import type { ZodIssue } from "zod";
import type { CredentialFormIssueCode } from "@cryptex-industries/vault-core/vault-utils/vault";

/** Mobile wording for a CredentialFormSchema issue, or undefined without one. */
export function credentialFormIssueText(
    issue: ZodIssue | undefined,
): string | undefined {
    if (!issue) return undefined;
    if (issue.code === "custom") {
        switch (issue.params?.code as CredentialFormIssueCode | undefined) {
            case "PASSKEY_INCOMPLETE":
                return t`Passkey credential material is incomplete.`;
            case "SSH_KEY_DAMAGED":
                return t`This SSH key's data is damaged.`;
            case "SSH_KEY_MISSING":
                return t`Generate a new key or import an existing one.`;
            case "URL_INVALID":
                return t`Enter a valid website, Android app, or safe wildcard pattern.`;
        }
        return issue.message;
    }
    const field = issue.path.join(".");
    if (field === "Name" && issue.code === "too_small")
        return t`This is a required field`;
    if (field === "Name" && issue.code === "too_big")
        return t`Name is too long`;
    if (field === "TOTP.Label" && issue.code === "too_big")
        return t`Label is too long`;
    if (field === "TOTP.Period" && issue.code === "too_small")
        return t`Period must be at least 1 second`;
    if (field === "TOTP.Digits" && issue.code === "too_small")
        return t`Digits must be at least 1`;
    return issue.message;
}
