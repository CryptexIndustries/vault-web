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

type BackupStatus = {
    storageConfigured: boolean;
    enabled: boolean;
    entitled: boolean;
    recoveryConfigured: boolean;
    graceExpiresAt: Date | null;
    latestReadyAt: Date | null;
    versionCount: number;
    storageBytes: number;
    maxAccountBytes: number;
    accountRecoveryProtection: "protected" | "pending" | "degraded" | null;
};

type Snapshot = {
    id: string;
    createdAt: Date;
    byteLength: number;
    sourceLabel: string;
};

type StatusQuery = {
    data: BackupStatus | undefined;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: jest.Mock<() => Promise<void>>;
};

type HistoryQuery = {
    data: { pages: { items: Snapshot[]; nextCursor: string | null }[] };
    isError: boolean;
    isFetchingNextPage: boolean;
    isFetchNextPageError: boolean;
    hasNextPage: boolean;
    fetchNextPage: jest.Mock<() => Promise<void>>;
};

const statusUseQueryMock = jest.fn();
const listUseInfiniteQueryMock = jest.fn();
const statusInvalidateMock = jest.fn<() => Promise<void>>();
const listInvalidateMock = jest.fn<() => Promise<void>>();
const statusRefetchMock = jest.fn<() => Promise<void>>();
const fetchNextPageMock = jest.fn<() => Promise<void>>();
const enableBackupMock = jest.fn<() => Promise<void>>();
const disableBackupMock = jest.fn<() => Promise<void>>();
const deleteBackupMock =
    jest.fn<(input: { snapshotId: string }) => Promise<void>>();
const deleteAllBackupsMock = jest.fn<() => Promise<void>>();
const backupNowMock = jest.fn<() => Promise<void>>();
const setBackupEnabledMock = jest.fn<(enabled: boolean) => void>();
const downloadBackupBytesMock = jest.fn<
    (snapshotId: string) => Promise<{
        bytes: Uint8Array;
        snapshot: { createdAt: Date };
    }>
>();
const downloadBackupFileMock = jest.fn();
const toastErrorMock = jest.fn();
const toastSuccessMock = jest.fn();

let mockCloudServicesEnabled = true;
let mockOnlineServicesData: {
    sessionToken?: string;
    remoteData?: { root: boolean };
};
let mockStatusQuery: StatusQuery;
let mockHistoryQuery: HistoryQuery;

jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => mockCloudServicesEnabled,
}));

jest.mock("@/app_lib/use-online-services-data", () => ({
    useOnlineServicesData: () => mockOnlineServicesData,
}));

jest.mock("@/app_lib/managed-backup-coordinator", () => ({
    MANAGED_BACKUP_STATUS_EVENT: "cryptex:managed-backup-status",
    managedBackupCoordinator: {
        backupNow: backupNowMock,
        setEnabled: setBackupEnabledMock,
    },
}));

jest.mock("@/app_lib/managed-backups", () => ({
    downloadBackupBytes: downloadBackupBytesMock,
    downloadBackupFile: downloadBackupFileMock,
}));

jest.mock("@/utils/logging", () => ({
    vaultLog: { error: jest.fn() },
}));

jest.mock("sonner", () => ({
    toast: {
        error: toastErrorMock,
        success: toastSuccessMock,
    },
}));

jest.mock("@/utils/trpc", () => ({
    trpcReact: {
        useUtils: () => ({
            v1: {
                backup: {
                    status: { invalidate: statusInvalidateMock },
                    list: { invalidate: listInvalidateMock },
                },
            },
        }),
        v1: {
            backup: {
                status: { useQuery: statusUseQueryMock },
                list: { useInfiniteQuery: listUseInfiniteQueryMock },
                enable: {
                    useMutation: () => ({
                        mutateAsync: enableBackupMock,
                        isPending: false,
                    }),
                },
                disable: {
                    useMutation: () => ({
                        mutateAsync: disableBackupMock,
                        isPending: false,
                    }),
                },
                delete: {
                    useMutation: () => ({
                        mutateAsync: deleteBackupMock,
                        isPending: false,
                    }),
                },
                deleteAll: {
                    useMutation: () => ({
                        mutateAsync: deleteAllBackupsMock,
                        isPending: false,
                    }),
                },
            },
        },
    },
}));

import { ManagedBackupsSettingsCard } from "@/components/vault-dashboard/managed-backups-settings-card";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function status(overrides: Partial<BackupStatus> = {}): BackupStatus {
    return {
        storageConfigured: true,
        enabled: true,
        entitled: true,
        recoveryConfigured: true,
        graceExpiresAt: null,
        latestReadyAt: new Date("2026-08-09T12:00:00Z"),
        versionCount: 1,
        storageBytes: 2048,
        maxAccountBytes: 1024 * 1024,
        accountRecoveryProtection: "protected",
        ...overrides,
    };
}

function snapshot(id: string, sourceLabel: string): Snapshot {
    return {
        id,
        createdAt: new Date(
            `2026-08-0${id === "snapshot-1" ? "9" : "8"}T12:00:00Z`,
        ),
        byteLength: 2048,
        sourceLabel,
    };
}

function queryButton(
    container: ParentNode,
    text: string,
): HTMLButtonElement | undefined {
    return [...container.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(text),
    );
}

function findButton(container: ParentNode, text: string): HTMLButtonElement {
    const button = queryButton(container, text);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${text}`);
    }
    return button;
}

function findDialog(): HTMLElement {
    const dialog = document.body.querySelector<HTMLElement>(
        '[role="alertdialog"]',
    );
    if (!dialog) throw new Error("Alert dialog not found");
    return dialog;
}

async function click(button: HTMLButtonElement): Promise<void> {
    await act(async () => {
        button.click();
        await Promise.resolve();
    });
}

describe("managed backup settings card", () => {
    let container: HTMLDivElement;
    let root: Root;
    const onAccountActionMock = jest.fn();

    const renderCard = () => {
        act(() => {
            root.render(
                <ManagedBackupsSettingsCard
                    open
                    onAccountAction={onAccountActionMock}
                />,
            );
        });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockCloudServicesEnabled = true;
        mockOnlineServicesData = {
            sessionToken: "session-token",
            remoteData: { root: true },
        };
        mockStatusQuery = {
            data: status(),
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: statusRefetchMock,
        };
        mockHistoryQuery = {
            data: {
                pages: [
                    {
                        items: [snapshot("snapshot-1", "Root device")],
                        nextCursor: null,
                    },
                ],
            },
            isError: false,
            isFetchingNextPage: false,
            isFetchNextPageError: false,
            hasNextPage: false,
            fetchNextPage: fetchNextPageMock,
        };
        statusUseQueryMock.mockImplementation(() => mockStatusQuery);
        listUseInfiniteQueryMock.mockImplementation(() => mockHistoryQuery);
        statusInvalidateMock.mockResolvedValue();
        listInvalidateMock.mockResolvedValue();
        statusRefetchMock.mockResolvedValue();
        fetchNextPageMock.mockResolvedValue();
        enableBackupMock.mockResolvedValue();
        disableBackupMock.mockResolvedValue();
        deleteBackupMock.mockResolvedValue();
        deleteAllBackupsMock.mockResolvedValue();
        backupNowMock.mockResolvedValue();
        downloadBackupBytesMock.mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            snapshot: { createdAt: new Date("2026-08-09T12:00:00Z") },
        });
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("gates backup data behind an Online Services session", async () => {
        mockOnlineServicesData = {};
        renderCard();

        expect(container.textContent).toContain("Sign in required");
        expect(statusUseQueryMock).toHaveBeenCalledWith(undefined, {
            enabled: false,
        });
        await click(findButton(container, "Sign in"));
        expect(onAccountActionMock).toHaveBeenCalledTimes(1);
    });

    it("distinguishes expired Premium access from a downloadable grace period", () => {
        mockStatusQuery.data = status({
            enabled: false,
            entitled: false,
            graceExpiresAt: new Date("2020-01-01T00:00:00Z"),
        });
        renderCard();

        expect(container.textContent).toContain("Premium required");
        expect(findButton(container, "Upgrade")).toBeDefined();

        mockStatusQuery.data = status({
            enabled: false,
            entitled: false,
            graceExpiresAt: new Date("2099-01-01T00:00:00Z"),
        });
        renderCard();

        expect(container.textContent).toContain("Premium ended");
        expect(container.textContent).toContain("Retained restore points");
        expect(container.querySelector(".lucide-download")).not.toBeNull();
    });

    it("appends history pages and preserves them when loading the next page fails", async () => {
        mockHistoryQuery.data = {
            pages: [
                {
                    items: [snapshot("snapshot-1", "Root device")],
                    nextCursor: "snapshot-1",
                },
                {
                    items: [snapshot("snapshot-2", "Linked device")],
                    nextCursor: "snapshot-2",
                },
            ],
        };
        mockHistoryQuery.hasNextPage = true;
        renderCard();

        expect(container.textContent).toContain("Root device");
        expect(container.textContent).toContain("Linked device");
        await click(findButton(container, "Load older backups"));
        expect(fetchNextPageMock).toHaveBeenCalledTimes(1);

        mockHistoryQuery.isFetchNextPageError = true;
        renderCard();

        expect(container.textContent).toContain("Root device");
        expect(container.textContent).toContain("Linked device");
        expect(
            findButton(container, "Retry loading older backups"),
        ).toBeDefined();
    });

    it("enables backups, refreshes both queries, and performs the first upload", async () => {
        mockStatusQuery.data = status({ enabled: false });
        renderCard();

        await click(findButton(container, "Enable Managed Backups"));
        await click(findButton(findDialog(), "Enable backups"));

        expect(enableBackupMock).toHaveBeenCalledTimes(1);
        expect(setBackupEnabledMock).toHaveBeenCalledWith(true);
        expect(statusInvalidateMock).toHaveBeenCalledTimes(1);
        expect(listInvalidateMock).toHaveBeenCalledTimes(1);
        expect(backupNowMock).toHaveBeenCalledTimes(1);
        expect(toastSuccessMock).toHaveBeenCalledWith(
            "Managed encrypted backups enabled.",
        );
    });

    it("refreshes status and history after manual backup and pause", async () => {
        renderCard();

        await click(findButton(container, "Backup Now"));
        expect(backupNowMock).toHaveBeenCalledTimes(1);
        expect(statusInvalidateMock).toHaveBeenCalledTimes(1);
        expect(listInvalidateMock).toHaveBeenCalledTimes(1);

        await click(findButton(container, "Pause"));
        expect(disableBackupMock).toHaveBeenCalledTimes(1);
        expect(setBackupEnabledMock).toHaveBeenCalledWith(false);
        expect(statusInvalidateMock).toHaveBeenCalledTimes(2);
        expect(listInvalidateMock).toHaveBeenCalledTimes(2);
    });

    it("requires confirmation before deleting one restore point", async () => {
        renderCard();
        const deleteIcons =
            container.querySelectorAll<SVGElement>(".lucide-trash-2");
        const deleteIcon = deleteIcons.item(deleteIcons.length - 1);
        const trigger = deleteIcon?.closest("button");
        if (!(trigger instanceof HTMLButtonElement)) {
            throw new Error("Delete restore point trigger not found");
        }

        await click(trigger);
        expect(deleteBackupMock).not.toHaveBeenCalled();
        await click(findButton(findDialog(), "Delete"));

        expect(deleteBackupMock).toHaveBeenCalledWith({
            snapshotId: "snapshot-1",
        });
        expect(statusInvalidateMock).toHaveBeenCalledTimes(1);
        expect(listInvalidateMock).toHaveBeenCalledTimes(1);
    });

    it("deletes all restore points only after confirmation and disables scheduling", async () => {
        renderCard();

        await click(findButton(container, "Delete All"));
        expect(deleteAllBackupsMock).not.toHaveBeenCalled();
        await click(findButton(findDialog(), "Delete all"));

        expect(deleteAllBackupsMock).toHaveBeenCalledTimes(1);
        expect(setBackupEnabledMock).toHaveBeenCalledWith(false);
        expect(statusInvalidateMock).toHaveBeenCalledTimes(1);
        expect(listInvalidateMock).toHaveBeenCalledTimes(1);
    });
});
