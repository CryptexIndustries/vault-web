/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
    registerVaultActionStateIndicator,
    setVaultActionState,
} from "../src/background/action-icon";

const setIcon = jest.fn<() => Promise<void>>();
const setTitle = jest.fn<() => Promise<void>>();
const sessionGet = jest.fn<() => Promise<Record<string, unknown>>>();
let storageChangeListener: (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
) => void;

beforeEach(() => {
    jest.clearAllMocks();
    setIcon.mockResolvedValue(undefined);
    setTitle.mockResolvedValue(undefined);
    sessionGet.mockResolvedValue({});

    globalThis.chrome = {
        action: { setIcon, setTitle },
        runtime: {
            getManifest: () => ({ name: "Cryptex Vault" }),
        },
        storage: {
            session: { get: sessionGet },
            onChanged: {
                addListener: (listener: typeof storageChangeListener) => {
                    storageChangeListener = listener;
                },
            },
        },
    } as unknown as typeof chrome;
});

describe("vault action state indicator", () => {
    it("uses the locked icon and accessible title for a locked vault", async () => {
        await setVaultActionState(false);

        expect(setIcon).toHaveBeenCalledWith({
            path: {
                16: "assets/icons/icon-16.png",
                32: "assets/icons/icon-32.png",
                48: "assets/icons/icon-48.png",
            },
        });
        expect(setTitle).toHaveBeenCalledWith({
            title: "Cryptex Vault - Vault locked",
        });
    });

    it("restores and tracks the unlocked session state", async () => {
        sessionGet.mockResolvedValue({ UVM: "encoded-metadata" });
        registerVaultActionStateIndicator();
        await Promise.resolve();
        await Promise.resolve();

        expect(setIcon).toHaveBeenLastCalledWith({
            path: expect.objectContaining({
                16: "assets/icons/icon-16.png",
            }),
        });

        storageChangeListener(
            { UVM: { oldValue: "encoded-metadata", newValue: undefined } },
            "session",
        );
        await Promise.resolve();

        expect(setIcon).toHaveBeenLastCalledWith({
            path: expect.objectContaining({
                16: "assets/icons/icon-16.png",
            }),
        });
    });
});
