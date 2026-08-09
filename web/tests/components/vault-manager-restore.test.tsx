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

type MockTurnstileProps = {
    onSuccess: (token: string) => void;
    onExpire?: () => void;
    onError?: () => void;
};

const createRecoverySessionMock = jest.fn<() => Promise<unknown>>();
const createRecoverySessionTokenMock = jest.fn(() => "s".repeat(32));
const listAllRecoverySnapshotsMock = jest.fn<() => Promise<unknown[]>>();
const downloadRecoveryBackupBytesMock =
    jest.fn<
        (
            sessionToken: string,
            snapshotId: string,
        ) => Promise<{ bytes: Uint8Array; snapshot: { createdAt: Date } }>
    >();
const turnstileResetMock = jest.fn();
const turnstileRenderMock = jest.fn();
const toastErrorMock = jest.fn();
const executeCallbackMock = jest.fn(
    async (_formData: unknown) => false as const,
);
let mockTurnstileProps: MockTurnstileProps;

jest.mock("@marsidev/react-turnstile", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        Turnstile: React.forwardRef<unknown, MockTurnstileProps>(
            (props, ref) => {
                turnstileRenderMock();
                mockTurnstileProps = props;
                React.useImperativeHandle(ref, () => ({
                    reset: turnstileResetMock,
                }));
                return null;
            },
        ),
    };
});

jest.mock("@/env/client.mjs", () => ({
    env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key" },
}));

jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));

jest.mock("@/utils/trpc", () => ({
    trpc: {
        v1: {
            backup: {
                createRecoverySession: { mutate: createRecoverySessionMock },
            },
        },
    },
}));

jest.mock("@/app_lib/managed-backups", () => ({
    createBackupRecoverySessionToken: createRecoverySessionTokenMock,
    downloadRecoveryBackupBytes: downloadRecoveryBackupBytesMock,
    listAllRecoverySnapshots: listAllRecoverySnapshotsMock,
    recommendNewestSnapshot: () => null,
    sortSnapshotsNewestFirst: (items: unknown[]) => items,
}));

jest.mock("sonner", () => ({
    toast: {
        error: toastErrorMock,
        message: jest.fn(),
        success: jest.fn(),
    },
}));

import RestoreTab from "@/components/vault-manager/restore";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setFieldValue(
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

function queryButton(
    container: HTMLElement,
    text: string,
): HTMLButtonElement | undefined {
    return [...container.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(text),
    );
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
    const button = queryButton(container, text);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${text}`);
    }
    return button;
}

function querySnapshotButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(
        'button[aria-label^="Restore point from"]',
    );
}

async function chooseFile(container: HTMLElement, file: File) {
    const input = container.querySelector<HTMLInputElement>(
        "#restore-backup-file",
    );
    if (!input) throw new Error("Backup file input not found");
    Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
    });
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

describe("fresh-device managed backup recovery", () => {
    let container: HTMLDivElement;
    let root: Root;

    const openCloudRecovery = () => {
        act(() => {
            findButton(container, "Managed Backups").click();
        });

        const userId = container.querySelector<HTMLInputElement>(
            'input[placeholder="Online Services User ID"]',
        );
        const phrase = container.querySelector<HTMLTextAreaElement>(
            'textarea[placeholder="Online Services Recovery Kit phrase"]',
        );
        if (!userId || !phrase) throw new Error("Recovery fields not found");
        act(() => {
            setFieldValue(userId, "user-1");
            setFieldValue(phrase, "word ".repeat(24).trim());
        });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        createRecoverySessionMock.mockReset();
        createRecoverySessionTokenMock.mockClear();
        listAllRecoverySnapshotsMock.mockReset();
        downloadRecoveryBackupBytesMock.mockReset();
        executeCallbackMock.mockClear();
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
        act(() => {
            root.render(<RestoreTab executeCallback={executeCallbackMock} />);
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("does not mount CAPTCHA for the local backup path", () => {
        expect(turnstileRenderMock).not.toHaveBeenCalled();
        expect(container.querySelector("#restore-backup-file")).not.toBeNull();
        expect(turnstileRenderMock).not.toHaveBeenCalled();
    });

    it("accepts a local backup and submits it without cloud recovery", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "vault.cryx");

        await chooseFile(container, file);
        expect(turnstileRenderMock).not.toHaveBeenCalled();

        await act(async () => {
            findButton(container, "Restore Vault").click();
        });

        expect(executeCallbackMock).toHaveBeenCalledWith(
            expect.objectContaining({ BackupFile: file }),
        );
    });

    it("rejects an unsupported file before showing restore details", async () => {
        await chooseFile(container, new File(["nope"], "vault.txt"));

        expect(toastErrorMock).toHaveBeenCalledWith(
            "Choose a .cryx vault backup file.",
        );
        expect(queryButton(container, "Restore Vault")).toBeUndefined();
    });

    it("clears the selected backup when switching restore sources", async () => {
        await chooseFile(container, new File(["vault"], "vault.cryx"));
        expect(findButton(container, "Restore Vault")).toBeDefined();

        act(() => findButton(container, "Managed Backups").click());
        expect(queryButton(container, "Restore Vault")).toBeUndefined();
        expect(turnstileRenderMock).toHaveBeenCalled();

        act(() => findButton(container, "Use a backup file").click());
        expect(container.querySelector("#restore-backup-file")).not.toBeNull();
        expect(queryButton(container, "Restore Vault")).toBeUndefined();
    });

    it("requests a fresh CAPTCHA while retaining the session token after an ambiguous failure", async () => {
        openCloudRecovery();
        createRecoverySessionMock
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce({ expiresAt: new Date() });
        listAllRecoverySnapshotsMock.mockResolvedValue([]);

        act(() => mockTurnstileProps.onSuccess("captcha-1"));
        await act(async () => {
            findButton(container, "Find Root Restore Points").click();
        });

        expect(turnstileResetMock).toHaveBeenCalledTimes(1);
        expect(findButton(container, "Find Root Restore Points").disabled).toBe(
            true,
        );

        act(() => mockTurnstileProps.onSuccess("captcha-2"));
        await act(async () => {
            findButton(container, "Find Root Restore Points").click();
        });

        expect(createRecoverySessionMock).toHaveBeenNthCalledWith(1, {
            userId: "user-1",
            recoveryPhrase: "word ".repeat(24).trim(),
            captchaToken: "captcha-1",
            sessionToken: "s".repeat(32),
        });
        expect(createRecoverySessionMock).toHaveBeenNthCalledWith(2, {
            userId: "user-1",
            recoveryPhrase: "word ".repeat(24).trim(),
            captchaToken: "captcha-2",
            sessionToken: "s".repeat(32),
        });
        expect(createRecoverySessionTokenMock).toHaveBeenCalledTimes(1);
    });

    it("keeps cloud authorization disabled until credentials are entered", () => {
        act(() => findButton(container, "Managed Backups").click());
        act(() => mockTurnstileProps.onSuccess("captcha-1"));

        expect(findButton(container, "Find Root Restore Points").disabled).toBe(
            true,
        );
    });

    it("retries listing through the confirmed session without another CAPTCHA", async () => {
        openCloudRecovery();
        createRecoverySessionMock.mockResolvedValue({ expiresAt: new Date() });
        listAllRecoverySnapshotsMock
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce([]);

        act(() => mockTurnstileProps.onSuccess("captcha-1"));
        await act(async () => {
            findButton(container, "Find Root Restore Points").click();
        });

        expect(turnstileResetMock).toHaveBeenCalledTimes(1);
        expect(findButton(container, "Find Root Restore Points").disabled).toBe(
            false,
        );

        await act(async () => {
            findButton(container, "Find Root Restore Points").click();
        });

        expect(createRecoverySessionMock).toHaveBeenCalledTimes(1);
        expect(listAllRecoverySnapshotsMock).toHaveBeenCalledTimes(2);
        expect(listAllRecoverySnapshotsMock).toHaveBeenLastCalledWith(
            "s".repeat(32),
        );
    });

    it("disables authorization when the CAPTCHA expires", () => {
        openCloudRecovery();
        act(() => mockTurnstileProps.onSuccess("captcha-1"));
        expect(findButton(container, "Find Root Restore Points").disabled).toBe(
            false,
        );

        act(() => mockTurnstileProps.onExpire?.());

        expect(findButton(container, "Find Root Restore Points").disabled).toBe(
            true,
        );
    });

    it("invalidates an authorized snapshot list when credentials change", async () => {
        openCloudRecovery();
        createRecoverySessionMock.mockResolvedValue({ expiresAt: new Date() });
        listAllRecoverySnapshotsMock.mockResolvedValue([
            {
                id: "snapshot-1",
                createdAt: new Date("2026-08-09T10:00:00Z"),
                sourceLabel: "Root device",
                byteLength: 1024,
            },
        ]);

        act(() => mockTurnstileProps.onSuccess("captcha-1"));
        await act(async () => {
            findButton(container, "Find Root Restore Points").click();
        });
        expect(querySnapshotButton(container)).not.toBeNull();

        const userId = container.querySelector<HTMLInputElement>(
            'input[placeholder="Online Services User ID"]',
        );
        if (!userId) throw new Error("User ID field not found");
        act(() => setFieldValue(userId, "user-2"));

        expect(querySnapshotButton(container)).toBeNull();
        expect(findButton(container, "Find Root Restore Points").disabled).toBe(
            true,
        );
    });

    it("downloads a cloud snapshot into the normal restore form", async () => {
        openCloudRecovery();
        const createdAt = new Date("2026-08-09T10:00:00Z");
        createRecoverySessionMock.mockResolvedValue({ expiresAt: new Date() });
        listAllRecoverySnapshotsMock.mockResolvedValue([
            {
                id: "snapshot-1",
                createdAt,
                sourceLabel: "Root device",
                byteLength: 3,
            },
        ]);
        downloadRecoveryBackupBytesMock.mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            snapshot: { createdAt },
        });

        act(() => mockTurnstileProps.onSuccess("captcha-1"));
        await act(async () => {
            findButton(container, "Find Root Restore Points").click();
        });
        await act(async () => {
            const snapshotButton = querySnapshotButton(container);
            if (!snapshotButton) throw new Error("Snapshot button not found");
            snapshotButton.click();
        });

        expect(downloadRecoveryBackupBytesMock).toHaveBeenCalledWith(
            "s".repeat(32),
            "snapshot-1",
        );
        await act(async () => {
            findButton(container, "Restore Vault").click();
        });
        expect(executeCallbackMock).toHaveBeenCalledWith(
            expect.objectContaining({
                BackupFile: expect.objectContaining({
                    name: `cryptexvault-cloud-${createdAt.getTime()}.cryx`,
                }),
            }),
        );
    });
});
