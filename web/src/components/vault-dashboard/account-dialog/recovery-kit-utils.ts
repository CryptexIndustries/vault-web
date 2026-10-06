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

export function buildRecoveryKitPrintHtml(
    userId: string,
    recoveryPhrase: string,
): string {
    const words = splitRecoveryPhrase(recoveryPhrase);
    const wordGrid = words
        .map(
            (word, index) =>
                `<li><span class="num">${index + 1}.</span> ${escapeHtml(word)}</li>`,
        )
        .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Cryptex Vault Recovery Kit</title>
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
  <h1>Cryptex Vault Recovery Kit</h1>
  <p class="meta">Generated ${escapeHtml(new Date().toLocaleString())}</p>
  <div class="warn">
    <strong>Important:</strong> Store this document offline in a safe place.
    Account recovery requires <strong>both</strong> your User ID and recovery phrase.
    Cryptex Vault shows this once and cannot retrieve it for you later.
  </div>
  <label>User ID</label>
  <div class="userid">${escapeHtml(userId)}</div>
  <label>Recovery phrase</label>
  <ol class="words">${wordGrid}</ol>
  <footer>
    Do not store in cloud drives, email, or password managers tied to this account.
  </footer>
  </main>
</body>
</html>`;
}

export function downloadRecoveryKitHtml(
    userId: string,
    recoveryPhrase: string,
): void {
    const html = buildRecoveryKitPrintHtml(userId, recoveryPhrase);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cryptex-recovery-kit-${userId.slice(0, 8)}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
}

export function printRecoveryKit(
    userId: string,
    recoveryPhrase: string,
): boolean {
    if (typeof document === "undefined") return false;

    const html = buildRecoveryKitPrintHtml(userId, recoveryPhrase);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "Cryptex Vault Recovery Kit");
    // Zero-size or opacity:0 iframes open the print dialog but produce a blank
    // preview in Chromium/Firefox. Keep real dimensions off-screen instead.
    iframe.style.cssText =
        "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;";

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        iframe.remove();
    };

    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDoc = iframe.contentDocument ?? frameWindow?.document;
    if (!frameWindow || !frameDoc) {
        cleanup();
        return false;
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    const triggerPrint = () => {
        frameWindow.onafterprint = cleanup;
        window.setTimeout(cleanup, 60_000);
        frameWindow.focus();
        frameWindow.print();
    };

    // One layout frame so the recovery kit is painted before print().
    window.requestAnimationFrame(triggerPrint);
    return true;
}
