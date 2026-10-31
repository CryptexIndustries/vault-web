export const RECOVERY_PHRASE_WORD_COUNT = 24;

export function splitRecoveryPhrase(phrase: string): string[] {
    return phrase.trim().split(/\s+/).filter(Boolean);
}

export function normalizeRecoveryWord(word: string): string {
    return word.trim().toLowerCase();
}

export function splitRecoveryPhraseIntoSlots(
    phrase: string,
    wordCount: number = RECOVERY_PHRASE_WORD_COUNT,
): string[] {
    const words = splitRecoveryPhrase(phrase).map(normalizeRecoveryWord);
    return Array.from({ length: wordCount }, (_, index) => words[index] ?? "");
}

export function joinRecoveryPhrase(
    words: readonly string[],
    wordCount: number = RECOVERY_PHRASE_WORD_COUNT,
): string {
    return words
        .slice(0, wordCount)
        .map(normalizeRecoveryWord)
        .filter(Boolean)
        .join(" ");
}

export function countRecoveryPhraseWords(phrase: string): number {
    return splitRecoveryPhrase(phrase).length;
}

export function buildRecoveryKitCopyText(
    userId: string,
    recoveryPhrase: string,
): string {
    return [
        "Cryptex Vault - Online Services Recovery Kit",
        "",
        "Store offline. Recovery requires BOTH fields below.",
        "",
        `User ID: ${userId}`,
        "",
        `Recovery phrase: ${recoveryPhrase.trim()}`,
        "",
        "Anyone with both can recover your Online Services account.",
    ].join("\n");
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/** The printed kit's wording. `warning` may use <strong> tags; everything else is escaped. */
export type RecoveryKitPrintText = {
    lang: string;
    title: string;
    generated: string;
    warning: string;
    userIdLabel: string;
    recoveryPhraseLabel: string;
    footer: string;
};

const englishPrintText = (): RecoveryKitPrintText => ({
    lang: "en",
    title: "Cryptex Vault Recovery Kit",
    generated: `Generated ${new Date().toLocaleString()}`,
    warning: `<strong>Important:</strong> Store this document offline in a safe place.
    Account recovery requires <strong>both</strong> your User ID and recovery phrase.
    Cryptex Vault shows this once and cannot retrieve it for you later.`,
    userIdLabel: "User ID",
    recoveryPhraseLabel: "Recovery phrase",
    footer: "Do not store in cloud drives, email, or password managers tied to this account.",
});

export function buildRecoveryKitPrintHtml(
    userId: string,
    recoveryPhrase: string,
    text: RecoveryKitPrintText = englishPrintText(),
): string {
    const words = splitRecoveryPhrase(recoveryPhrase);
    const wordGrid = words
        .map(
            (word, index) =>
                `<li><span class="num">${index + 1}.</span> ${escapeHtml(word)}</li>`,
        )
        .join("");

    return `<!DOCTYPE html>
<html lang="${escapeHtml(text.lang)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(text.title)}</title>
  <style>
    html, body { margin: 0; padding: 0; min-height: 100%; }
    body {
      font-family: system-ui, sans-serif;
      color: #111;
      line-height: 1.5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 2rem;
      box-sizing: border-box;
    }
    .kit { width: 100%; max-width: 640px; text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
    .meta { color: #555; font-size: 0.9rem; margin: 0 0 1.5rem; }
    .warn {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin: 0 auto 1.5rem;
      font-size: 0.9rem;
      text-align: left;
    }
    label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #555;
      margin-bottom: 0.35rem;
    }
    .userid {
      font-family: ui-monospace, monospace;
      font-size: 0.85rem;
      word-break: break-all;
      border: 1px solid #ddd;
      padding: 0.75rem;
      border-radius: 8px;
      margin: 0 auto 1.25rem;
      text-align: left;
    }
    .words {
      list-style: none;
      padding: 0;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
      text-align: left;
    }
    .words li {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 0.4rem 0.5rem;
      font-family: ui-monospace, monospace;
      font-size: 0.85rem;
    }
    .num { color: #888; margin-right: 0.25rem; }
    footer { margin-top: 2rem; font-size: 0.8rem; color: #666; }
    @media print {
      body {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 1rem;
      }
      .kit { margin: 0 auto; }
    }
  </style>
</head>
<body>
  <main class="kit">
  <h1>${escapeHtml(text.title)}</h1>
  <p class="meta">${escapeHtml(text.generated)}</p>
  <div class="warn">
    ${escapeHtml(text.warning).replaceAll("&lt;strong&gt;", "<strong>").replaceAll("&lt;/strong&gt;", "</strong>")}
  </div>
  <label>${escapeHtml(text.userIdLabel)}</label>
  <div class="userid">${escapeHtml(userId)}</div>
  <label>${escapeHtml(text.recoveryPhraseLabel)}</label>
  <ol class="words">${wordGrid}</ol>
  <footer>
    ${escapeHtml(text.footer)}
  </footer>
  </main>
</body>
</html>`;
}
