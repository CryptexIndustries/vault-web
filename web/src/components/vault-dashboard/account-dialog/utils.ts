import { toast } from "sonner";

export function formatAccountDate(value?: Date | string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleDateString();
}

export async function copyToClipboard(text: string, copiedLabel: string) {
    const trimmed = text.trim();
    if (!trimmed) {
        toast.error("Nothing to copy.");
        return;
    }
    try {
        await navigator.clipboard.writeText(trimmed);
        toast.success(`${copiedLabel} copied.`);
    } catch {
        toast.error("Could not copy to clipboard.");
    }
}
