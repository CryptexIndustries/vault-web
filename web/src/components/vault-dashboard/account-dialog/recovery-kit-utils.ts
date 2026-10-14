import { buildRecoveryKitPrintHtml } from "@ui/lib/recovery-kit-utils";

export * from "@ui/lib/recovery-kit-utils";

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
