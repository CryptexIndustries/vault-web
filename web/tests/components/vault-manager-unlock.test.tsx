/**
 * @jest-environment jsdom
 *
 * The unlock form starts one unlock at a time: Enter in the secret key
 * field while one runs (the Unlock button is disabled) starts nothing.
 */
import "../helpers/jsdom-encoding";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ok } from "neverthrow";
import { expect, it, jest } from "@jest/globals";
import UnlockTab from "@/components/vault-manager/unlock";
import { setNativeValue } from "../helpers/dom";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Past the form's 100 ms paint delay.
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
    });

it("ignores Enter while an unlock is running, and accepts it again after", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pending: ((value: unknown) => void)[] = [];
    const execute = jest.fn(
        () => new Promise((resolve) => pending.push(resolve)),
    );
    const enter = () =>
        act(async () => {
            secret.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
            );
        });
    let secret: HTMLInputElement = null!;
    try {
        await act(async () =>
            root.render(
                <UnlockTab
                    vaults={[
                        {
                            DBIndex: 1,
                            Name: "Main",
                            Blob: { Algorithm: 0, KeyDerivationFunc: 0 },
                        } as never,
                    ]}
                    executeCallback={execute as never}
                    deleteVaultCallback={async () => undefined}
                />,
            ),
        );
        secret = document.querySelector<HTMLInputElement>("#secret-key")!;
        await act(async () => setNativeValue(secret, "pw"));
        await enter();
        await settle();
        expect(execute).toHaveBeenCalledTimes(1);
        await enter();
        await settle();
        expect(execute).toHaveBeenCalledTimes(1);
        // A failed unlock lets the user try again.
        await act(async () =>
            pending.shift()!({ isErr: () => true, error: "x" }),
        );
        await settle();
        await enter();
        await settle();
        expect(execute).toHaveBeenCalledTimes(2);
        await act(async () => pending.shift()!(ok({})));
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
