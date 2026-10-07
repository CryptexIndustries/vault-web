// Test-only selection. Native ICE events and setLocalDescription resolve independently.
export function completedLocalDescription<T extends { sdp: string }>(
    state: string,
    current: T | null,
    retained?: T,
): T | undefined {
    if (state !== "complete") return;
    for (const description of [current, retained]) {
        if (description && /(?:^|\r?\n)a=candidate:/.test(description.sdp)) return description;
    }
}
