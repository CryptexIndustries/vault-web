/**
 * @jest-environment jsdom
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

import { createInlineIcon } from "../src/content/inline-icon";

class TestResizeObserver {
    observe(): void {}
    disconnect(): void {}
}

describe("inline icon", () => {
    beforeEach(() => {
        Object.defineProperty(globalThis, "ResizeObserver", {
            configurable: true,
            value: TestResizeObserver,
        });
        jest.spyOn(window, "requestAnimationFrame").mockImplementation(
            (callback: FrameRequestCallback) => {
                callback(0);
                return 1;
            },
        );
        jest.spyOn(window, "cancelAnimationFrame").mockImplementation(
            () => undefined,
        );
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.documentElement
            .querySelectorAll("[data-cryptex-autofill]")
            .forEach((element) => element.remove());
        jest.restoreAllMocks();
    });

    it("reserves text space and restores the field on destroy", () => {
        document.body.innerHTML = '<input style="padding-right: 4px" />';
        const field = document.querySelector("input")!;
        field.getBoundingClientRect = () =>
            ({
                width: 240,
                height: 40,
                top: 10,
                left: 20,
                right: 260,
                bottom: 50,
                x: 20,
                y: 10,
                toJSON: () => ({}),
            }) as DOMRect;

        const icon = createInlineIcon({
            field,
            mode: "autofill",
            onClick: jest.fn(),
        });

        expect(icon.element.style.position).toBe("fixed");
        expect(icon.element.style.visibility).toBe("visible");
        expect(icon.element.shadowRoot).toBeNull();
        expect(field.style.getPropertyPriority("padding-right")).toBe(
            "important",
        );

        icon.destroy();

        expect(icon.element.isConnected).toBe(false);
        expect(field.style.paddingRight).toBe("4px");
        expect(field.style.getPropertyPriority("padding-right")).toBe("");
    });

    it("stays hidden on narrow fields", () => {
        document.body.innerHTML = "<input />";
        const field = document.querySelector("input")!;
        field.getBoundingClientRect = () =>
            ({
                width: 80,
                height: 40,
                top: 10,
                left: 20,
                right: 100,
                bottom: 50,
                x: 20,
                y: 10,
                toJSON: () => ({}),
            }) as DOMRect;

        const icon = createInlineIcon({
            field,
            mode: "autofill",
            onClick: jest.fn(),
        });

        expect(icon.element.style.display).toBe("none");
        icon.destroy();
    });
});
