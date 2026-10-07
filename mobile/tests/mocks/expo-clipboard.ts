let clipboardValue = "";

export async function getStringAsync(): Promise<string> {
    return clipboardValue;
}

export async function setStringAsync(value: string): Promise<void> {
    clipboardValue = value;
}

export function __setClipboardForTests(value: string): void {
    clipboardValue = value;
}

export function __getClipboardForTests(): string {
    return clipboardValue;
}

export function __resetClipboardForTests(): void {
    clipboardValue = "";
}
