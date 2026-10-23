/** DOM helpers for component tests rendered with react-dom in jsdom. */
import { act } from "react";

/** Sets a field's value the way typing does, so React sees the change. */
export function setNativeValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
) {
    const prototype =
        element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        element,
        value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Polls read() inside act() until it returns something truthy. */
export async function waitFor<T>(
    read: () => T | null | undefined | false,
    timeoutMs = 5_000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value) return value;
        if (Date.now() > deadline) throw new Error("Timed out waiting");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
}
