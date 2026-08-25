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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditDrawer } from "@/components/vault-dashboard/edit-drawer";

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

describe("EditDrawer", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    it("keeps in-progress username and password when the selected directory changes", async () => {
        const onClose = jest.fn();
        const onSave = jest.fn(async () => true);
        const onCreateDirectory = jest.fn(async () => "dir-new");

        await act(async () => {
            root.render(
                <EditDrawer
                    credential={null}
                    isOpen={true}
                    onClose={onClose}
                    onSave={onSave}
                    directories={[]}
                    initialDirectoryID=""
                    onCreateDirectory={onCreateDirectory}
                />,
            );
        });

        const username = document.getElementById(
            "username",
        ) as HTMLInputElement | null;
        const password = document.getElementById(
            "password",
        ) as HTMLInputElement | null;
        expect(username).not.toBeNull();
        expect(password).not.toBeNull();

        await act(async () => {
            setNativeInputValue(username!, "user@example.com");
            setNativeInputValue(password!, "correct-horse");
        });

        expect(username!.value).toBe("user@example.com");
        expect(password!.value).toBe("correct-horse");

        await act(async () => {
            root.render(
                <EditDrawer
                    credential={null}
                    isOpen={true}
                    onClose={onClose}
                    onSave={onSave}
                    directories={[
                        {
                            ID: "dir-new",
                            Name: "Work",
                            Hash: "",
                            Version: 0,
                            DateModifiedTimestamp: 0,
                            Deleted: false,
                        },
                    ]}
                    initialDirectoryID="dir-new"
                    onCreateDirectory={onCreateDirectory}
                />,
            );
        });

        expect(
            (document.getElementById("username") as HTMLInputElement).value,
        ).toBe("user@example.com");
        expect(
            (document.getElementById("password") as HTMLInputElement).value,
        ).toBe("correct-horse");
    });
});
