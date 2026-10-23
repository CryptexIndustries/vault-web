import { toast } from "sonner";

export function formatAccountDate(value?: Date | string | null) {
    if (!value) return "-";
    // "November 5, 2026": numeric dates read differently across regions.
    return new Date(value).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
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
