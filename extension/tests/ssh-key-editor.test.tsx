/**
 * @jest-environment jsdom
 */
import "../../web/tests/helpers/jsdom-encoding";
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
import { setNativeValue, waitFor } from "../../web/tests/helpers/dom";
import { sshFixture } from "../../web/tests/helpers/ssh-fixtures";
import {
    runSSHKeyTask,
    type SSHKeyTask,
    type SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";

const mockRunTask = jest.fn<(task: SSHKeyTask) => Promise<SSHKeyTaskResult>>();

jest.mock("@/utils/ssh-key", () => ({
    ...jest.requireActual<typeof import("@/utils/ssh-key")>("@/utils/ssh-key"),
    runSSHKeyTaskInWorker: (task: SSHKeyTask) => mockRunTask(task),
}));

import { SSHKeyEditor } from "../src/components/ssh-key-editor";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KEY_TEXT = sshFixture("ed25519.key");

/** jsdom 20 has no Blob.text(), so hand the picker a plain file-like. */
async function chooseKeyFile() {
    const input = document.querySelector<HTMLInputElement>(
        '[data-testid="ssh-key-file-input"]',
    )!;
    Object.defineProperty(input, "files", {
        configurable: true,
        value: [
            {
                name: "ed25519.key",
                size: KEY_TEXT.length,
                text: async () => KEY_TEXT,
            },
        ],
    });
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

const buttonByText = (text: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === text,
    );

describe("SSHKeyEditor in the extension", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        mockRunTask.mockReset();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const render = async (
        props: Partial<React.ComponentProps<typeof SSHKeyEditor>> = {},
    ) => {
        await act(async () => {
            root.render(
                <SSHKeyEditor
                    mode="create"
                    value={null}
                    onChange={jest.fn()}
                    itemName=""
                    nameField={null}
                    {...props}
                />,
            );
        });
    };

    it("reports busy while checking and clears it when closed", async () => {
        mockRunTask.mockReturnValue(new Promise(() => undefined));
        const onBusyChange = jest.fn();
        await render({ onBusyChange, initialSource: "import" });

        await act(async () => {
            setNativeValue(
                document.getElementById(
                    "ssh-private-key",
                ) as HTMLTextAreaElement,
                "some key",
            );
        });
        expect(onBusyChange).toHaveBeenLastCalledWith(true);
        await waitFor(() => mockRunTask.mock.calls.length === 1);
        expect(document.body.textContent).toContain("Checking key...");

        act(() => root.unmount());
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
        root = createRoot(container);
    });

    it("hands both file buttons to the popup instead of opening a picker", async () => {
        const onChooseFile = jest.fn();
        await render({ initialSource: "import", onChooseFile });
        expect(
            document.querySelector<HTMLInputElement>('input[value="import"]')!
                .checked,
        ).toBe(true);

        const pickerClick = jest.fn();
        for (const input of document.querySelectorAll('input[type="file"]')) {
            input.addEventListener("click", pickerClick);
        }
        await act(async () => buttonByText("Choose file")!.click());
        await act(async () => buttonByText("Add .pub file")!.click());
        expect(onChooseFile).toHaveBeenCalledTimes(2);
        expect(pickerClick).not.toHaveBeenCalled();
    });

    it("is not left busy when the same key file is picked again", async () => {
        mockRunTask.mockImplementation(async (task) => runSSHKeyTask(task));
        const onBusyChange = jest.fn();
        await render({ onBusyChange, initialSource: "import" });

        await chooseKeyFile();
        await waitFor(() => mockRunTask.mock.calls.length === 1);
        await waitFor(() => onBusyChange.mock.lastCall?.[0] === false);

        await chooseKeyFile();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 700));
        });
        expect(mockRunTask).toHaveBeenCalledTimes(1);
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
    });
});
