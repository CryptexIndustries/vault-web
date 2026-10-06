import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
    beforeEach,
    afterEach,
    describe,
    it,
    expect,
    jest,
} from "@jest/globals";
import { useDeviceLongPress } from "@/components/vault-dashboard/use-device-long-press";
(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
function Row({ open }: { open: () => void }) {
    return (
        <div {...useDeviceLongPress(open)}>
            <span>Device</span>
            <button data-device-menu-trigger>Menu</button>
        </div>
    );
}
describe("sidebar device long press", () => {
    let container: HTMLDivElement, root: Root;
    beforeEach(() => {
        jest.useFakeTimers();
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        jest.useRealTimers();
    });
    function pointer(
        type: string,
        x = 0,
        pointerType = "touch",
        target: Element = container.firstElementChild!,
    ) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, {
            clientX: x,
            clientY: 0,
            pointerType,
            isPrimary: true,
        });
        act(() => target.dispatchEvent(event));
    }
    it("opens after a held touch and suppresses its synthetic click", () => {
        const open = jest.fn();
        act(() => root.render(<Row open={open} />));
        pointer("pointerdown");
        act(() => jest.advanceTimersByTime(500));
        expect(open).toHaveBeenCalledTimes(1);
        const click = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
        });
        act(() => container.firstElementChild!.dispatchEvent(click));
        expect(click.defaultPrevented).toBe(true);
    });
    it("cancels on scrolling, release, cancellation and unmount", () => {
        const open = jest.fn();
        act(() => root.render(<Row open={open} />));
        pointer("pointerdown");
        pointer("pointermove", 20);
        act(() => jest.advanceTimersByTime(600));
        pointer("pointerdown");
        pointer("pointerup");
        act(() => jest.advanceTimersByTime(600));
        pointer("pointerdown");
        pointer("pointercancel");
        act(() => jest.advanceTimersByTime(600));
        pointer("pointerdown");
        act(() => root.render(null));
        act(() => jest.advanceTimersByTime(600));
        expect(open).not.toHaveBeenCalled();
    });
    it("leaves mouse input and the menu button to their normal handlers", () => {
        const open = jest.fn();
        act(() => root.render(<Row open={open} />));
        pointer("pointerdown", 0, "mouse");
        act(() => jest.advanceTimersByTime(600));
        pointer("pointerdown", 0, "touch", container.querySelector("button")!);
        act(() => jest.advanceTimersByTime(600));
        expect(open).not.toHaveBeenCalled();
    });
});
