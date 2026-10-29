import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

import type { RecoveryKitPrintText } from "@ui/lib/recovery-kit-utils";

export function recoveryKitCopyText(
    userId: string,
    recoveryPhrase: string,
): string {
    const phrase = recoveryPhrase.trim();
    return [
        t`Cryptex Vault - Online Services Recovery Kit`,
        "",
        t`Store offline. Recovery requires BOTH fields below.`,
        "",
        t`User ID: ${userId}`,
        "",
        t`Recovery phrase: ${phrase}`,
        "",
        t`Anyone with both can recover your Online Services account.`,
    ].join("\n");
}

export function recoveryKitPrintText(): RecoveryKitPrintText {
    const date = new Date().toLocaleString(i18n.locale);
    return {
        lang: i18n.locale,
        title: t`Cryptex Vault Recovery Kit`,
        generated: t`Generated ${date}`,
        warning: t({
            message:
                "<strong>Important:</strong> Store this document offline in a safe place. Account recovery requires <strong>both</strong> your User ID and recovery phrase. Cryptex Vault shows this once and cannot retrieve it for you later.",
            comment: "HTML in the printed Recovery Kit; keep the <strong> tags",
        }),
        userIdLabel: t`User ID`,
        recoveryPhraseLabel: t`Recovery phrase`,
        footer: t`Do not store in cloud drives, email, or password managers tied to this account.`,
    };
}
