import { toast } from "sonner";

const SECRET_CLIPBOARD_MESSAGE =
    "Copied to clipboard. Clear it when done to stay on the safe side.";

type CopyOptions = { showSuccessToast?: boolean; toastId?: string };

async function writeToClipboard(
    text: string,
    options: CopyOptions,
    showCopied: (id?: string) => void,
) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        toast.error("Clipboard unavailable. Copy it manually.");
        return false;
    }

    if (options.showSuccessToast ?? true) showCopied(options.toastId);
    return true;
}

/** Copies a secret (password, code, private key) with a reminder to clear it. */
export function copySecretToClipboard(text: string, options: CopyOptions = {}) {
    return writeToClipboard(text, options, (id) =>
        toast.info(SECRET_CLIPBOARD_MESSAGE, { duration: 5000, id }),
    );
}

/** Copies a value that isn't secret, like a username or a public key. */
export function copyToClipboard(text: string, options: CopyOptions = {}) {
    return writeToClipboard(text, options, (id) =>
        toast.info("Copied", { duration: 2000, id }),
    );
}
