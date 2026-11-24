import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement, Fragment, type ReactNode } from "react";
import {
    act,
    create,
    type ReactTestInstance,
    type ReactTestRenderer,
} from "react-test-renderer";
import { Dialog, hideDialogs, type DialogProps } from "@/components/ui/dialog";
import { vaultLog } from "@/utils/logging";

type MockSheet = { open: boolean; shown: number; hidden: number };

jest.mock("react-native", () => ({
    ActivityIndicator: "ActivityIndicator",
    Animated: {
        View: "AnimatedView",
        Value: class {
            setValue = jest.fn();
            stopAnimation = jest.fn();
        },
    },
    Easing: { ease: "ease", out: (value: string) => value },
    KeyboardAvoidingView: "KeyboardAvoidingView",
    Modal: "Modal",
    Platform: { OS: "ios" },
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    View: "View",
}));
jest.mock("react-native-actions-sheet", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        __esModule: true,
        default: React.forwardRef((props: { children: ReactNode }, ref) => {
            const [sheet] = React.useState<MockSheet>(() => ({
                open: false,
                shown: 0,
                hidden: 0,
            }));
            React.useImperativeHandle(ref, () => ({
                show: () => {
                    sheet.open = true;
                    sheet.shown++;
                },
                hide: () => {
                    sheet.hidden++;
                },
                isOpen: () => sheet.open,
            }));
            return React.createElement(
                "ActionSheet",
                { ...props, sheet },
                props.children,
            );
        }),
        ScrollView: "SheetScrollView",
    };
});
jest.mock("react-native-gesture-handler", () => ({
    GestureHandlerRootView: "GestureHandlerRootView",
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@rn-primitives/portal", () => ({ Portal: "Portal" }));
jest.mock("@/hooks/use-reduced-motion", () => ({
    useReducedMotion: () => true,
}));
jest.mock("@/components/keyboard-scroll", () => ({
    KeyboardScrollProvider: "KeyboardScrollProvider",
}));
jest.mock("@/components/ui/text", () => ({ Text: "Text" }));

type Spec = Omit<DialogProps, "children"> & { name: string; inner?: Spec };

let renderer: ReactTestRenderer | undefined;
const onOpenChange = jest.fn();

function dialog({ name, inner, ...props }: Spec): ReactNode {
    const dialogProps: DialogProps = {
        placement: "bottom",
        onOpenChange,
        ...props,
        children: [
            createElement("Body", { key: "body", name }),
            inner ? dialog(inner) : null,
        ],
    };
    return createElement(Dialog, { key: name, ...dialogProps });
}

async function render(...specs: Spec[]) {
    await act(async () => {
        const element = createElement(Fragment, null, ...specs.map(dialog));
        if (renderer) renderer.update(element);
        else renderer = create(element);
    });
}

/** The nearest element of this type around the named dialog's body. */
function around(name: string, type: string): ReactTestInstance {
    let node: ReactTestInstance | null = renderer!.root.findByProps({ name });
    while (node && node.type !== type) node = node.parent;
    return node!;
}
const sheet = (name: string) =>
    around(name, "ActionSheet").props.sheet as MockSheet;
const modal = (name: string) => around(name, "Modal").props;

async function sheetClosed(name: string) {
    await act(async () => {
        sheet(name).open = false;
        around(name, "ActionSheet").props.onClose();
    });
}
// iOS reports this once the sheet's native window is gone, after onClose.
async function sheetDismissed(name: string) {
    await act(async () => around(name, "ActionSheet").props.onDismiss());
}

beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
});

it("opens a sheet earlier in the tree only after a later one has closed", async () => {
    await render({ name: "editor" }, { name: "confirm", open: true });
    expect(sheet("confirm").shown).toBe(1);
    // "Keep editing": the confirm closes and the editor reopens in one update.
    await render({ name: "editor", open: true }, { name: "confirm" });
    expect(sheet("confirm").hidden).toBe(1);
    expect(sheet("editor").shown).toBe(0);
    await sheetClosed("confirm");
    // The close animation is done, but the native window is still there.
    expect(sheet("editor").shown).toBe(0);
    await sheetDismissed("confirm");
    expect(sheet("editor").shown).toBe(1);
});

it("shows the next dialog and logs when a dismissal is never reported", async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(vaultLog, "warn");
    try {
        await render({ name: "menu", open: true }, { name: "move" });
        await render({ name: "menu" }, { name: "move", open: true });
        await sheetClosed("menu");
        await act(async () => jest.advanceTimersByTime(1999));
        expect(sheet("move").shown).toBe(0);
        await act(async () => jest.advanceTimersByTime(1));
        expect(sheet("move").shown).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
    } finally {
        warn.mockRestore();
        jest.useRealTimers();
    }
});

it("keeps a sheet waiting while another one stays open", async () => {
    await render({ name: "filter", open: true }, { name: "error" });
    await render({ name: "filter", open: true }, { name: "error", open: true });
    expect(sheet("error").shown).toBe(0);
    await render({ name: "filter" }, { name: "error", open: true });
    await sheetClosed("filter");
    await sheetDismissed("filter");
    expect(sheet("error").shown).toBe(1);
});

it("shows device sheets one at a time, after the native window is gone", async () => {
    await render(
        { name: "details", open: true, bottomSheetVariant: "device-detail" },
        { name: "confirm", bottomSheetVariant: "devices" },
    );
    expect(modal("details").visible).toBe(true);
    await render(
        { name: "details", bottomSheetVariant: "device-detail" },
        { name: "confirm", open: true, bottomSheetVariant: "devices" },
    );
    expect(modal("confirm").visible).toBe(false);
    await sheetClosed("details");
    expect(modal("details").visible).toBe(false);
    expect(modal("confirm").visible).toBe(false);
    await act(async () => modal("details").onDismiss());
    expect(modal("confirm").visible).toBe(true);
});

it("opens a centered dialog only after a closing sheet is gone, and the other way round", async () => {
    await render(
        { name: "confirm", open: true },
        { name: "check", placement: "center" },
    );
    await render(
        { name: "confirm" },
        { name: "check", placement: "center", open: true },
    );
    expect(modal("check").visible).toBe(false);
    await sheetClosed("confirm");
    expect(modal("check").visible).toBe(false);
    await sheetDismissed("confirm");
    expect(modal("check").visible).toBe(true);

    await render(
        { name: "confirm", open: true },
        { name: "check", placement: "center" },
    );
    expect(modal("check").visible).toBe(false);
    expect(sheet("confirm").shown).toBe(1);
    await act(async () => modal("check").onDismiss());
    expect(sheet("confirm").shown).toBe(2);
});

it("shows a dialog inside an open sheet at once", async () => {
    await render({
        name: "signup",
        open: true,
        inner: { name: "check", placement: "center", open: true },
    });
    expect(sheet("signup").shown).toBe(1);
    expect(modal("check").visible).toBe(true);
});

it("ignores a late dismissal from a presentation the safety net already released", async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(vaultLog, "warn").mockImplementation(() => {});
    try {
        await render({ name: "menu", open: true }, { name: "move" });
        await render({ name: "menu" }, { name: "move" });
        await sheetClosed("menu");
        await act(async () => jest.advanceTimersByTime(2000));
        await render({ name: "menu", open: true }, { name: "move" });
        expect(sheet("menu").shown).toBe(2);
        await render(
            { name: "menu", open: true },
            { name: "move", open: true },
        );
        // The first presentation's dismissal arrives only now.
        await sheetDismissed("menu");
        expect(sheet("move").shown).toBe(0);
    } finally {
        warn.mockRestore();
        jest.useRealTimers();
    }
});

it("keeps a reopened centered dialog's turn when its old dismissal arrives late", async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(vaultLog, "warn").mockImplementation(() => {});
    try {
        await render(
            { name: "check", placement: "center", open: true },
            { name: "menu" },
        );
        await render({ name: "check", placement: "center" }, { name: "menu" });
        await act(async () => jest.advanceTimersByTime(2000));
        await render(
            { name: "check", placement: "center", open: true },
            { name: "menu", open: true },
        );
        expect(modal("check").visible).toBe(true);
        // The first presentation's dismissal arrives only now.
        await act(async () => modal("check").onDismiss());
        await render(
            { name: "check", placement: "center" },
            { name: "menu", open: true },
        );
        expect(sheet("menu").shown).toBe(0);
        await act(async () => modal("check").onDismiss());
        expect(sheet("menu").shown).toBe(1);
    } finally {
        warn.mockRestore();
        jest.useRealTimers();
    }
});

it("steps dialogs aside for the approval prompt without closing them", async () => {
    await render({ name: "menu", open: true });
    let showDialogs: () => void = () => undefined;
    await act(async () => {
        showDialogs = hideDialogs();
    });
    expect(sheet("menu").hidden).toBe(1);
    await sheetClosed("menu");
    await sheetDismissed("menu");
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => showDialogs());
    expect(sheet("menu").shown).toBe(2);
});

it("brings back a sheet the approval prompt left before it finished closing", async () => {
    await render({ name: "menu", open: true });
    let showDialogs: () => void = () => undefined;
    await act(async () => {
        showDialogs = hideDialogs();
    });
    expect(sheet("menu").hidden).toBe(1);
    await act(async () => showDialogs());
    await sheetClosed("menu");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet("menu").shown).toBe(1);
    await sheetDismissed("menu");
    expect(sheet("menu").shown).toBe(2);
});
