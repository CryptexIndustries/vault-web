/**
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CredentialSearch } from "@/components/vault-dashboard/credential-search";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setNativeInputValue(element: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
    );
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
}

function ControlledSearch() {
    const [value, setValue] = useState("");
    return <CredentialSearch value={value} onChange={setValue} />;
}

describe("CredentialSearch", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("opens filtered field suggestions only after user input", async () => {
        await act(async () => {
            root.render(<ControlledSearch />);
        });

        const input = container.querySelector("input") as HTMLInputElement;
        const listbox = container.querySelector(
            '[role="listbox"]',
        ) as HTMLDivElement;

        expect(document.activeElement).toBe(input);
        expect(listbox.hidden).toBe(true);

        await act(async () => setNativeInputValue(input, "n"));
        expect(listbox.hidden).toBe(false);
        expect(
            Array.from(listbox.querySelectorAll('[role="option"]')).map(
                (option) => option.textContent,
            ),
        ).toEqual(["name:", "note:"]);

        await act(async () => setNativeInputValue(input, "ta"));
        expect(
            Array.from(listbox.querySelectorAll('[role="option"]')).map(
                (option) => option.textContent,
            ),
        ).toEqual(["tag:"]);

        await act(async () => setNativeInputValue(input, "x"));
        expect(listbox.hidden).toBe(true);
    });
});
