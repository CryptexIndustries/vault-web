import { toast } from "sonner";

const SECRET_CLIPBOARD_MESSAGE =
    "Copied to clipboard. Clear it when done to stay on the safe side.";

export async function copySecretToClipboard(
    text: string,
    options: { showToast?: boolean; toastId?: string } = {},
) {
    const showToast = options.showToast ?? true;

    try {
        await navigator.clipboard.writeText(text);
    } catch {
        if (showToast) {
            toast.error("Clipboard unavailable. Copy it manually.");
        }
        return false;
    }

    if (showToast) {
        toast.info(SECRET_CLIPBOARD_MESSAGE, {
            duration: 5000,
            id: options.toastId,
        });
    }

    return true;
}
