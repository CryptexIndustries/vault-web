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
import { useDeviceActions } from "@/components/vault-dashboard/use-device-actions";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";

const mockBreak = jest.fn<(input: unknown) => Promise<void>>();
const mockSave =
    jest.fn<
        (
            kind: unknown,
            mutation: (vault: unknown) => unknown,
        ) => Promise<{ isErr: () => boolean }>
    >();
const mockInvalidate = jest.fn<() => Promise<void>>();
const mockGet = jest.fn<() => unknown>();
jest.mock("@/utils/trpc", () => ({
    trpcReact: {
        useUtils: () => ({
            v1: {
                device: { invalidate: mockInvalidate },
                payment: { subscription: { invalidate: mockInvalidate } },
            },
        }),
        v1: {
            device: {
                breakLink: { useMutation: () => ({ mutateAsync: mockBreak }) },
            },
        },
    },
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: (...args: Parameters<typeof mockSave>) =>
        mockSave(...args),
}));
jest.mock("@/utils/atoms", () => ({ vaultGet: () => mockGet() }));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));
jest.mock("sonner", () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class {},
    LinkedDevices: {
        fromGeneric: (value: object) => ({ ...value }),
        isUsingOnlineServices: (d: { official: boolean }) => d.official,
    },
}));
(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let actions: ReturnType<typeof useDeviceActions>;
function Harness() {
    actions = useDeviceActions();
    return null;
}
const device = {
    ID: "peer",
    SyncID: "sync",
    official: true,
} as unknown as LinkedDevice;
describe("device unlink persistence", () => {
    let container: HTMLDivElement, root: Root;
    beforeEach(() => {
        jest.clearAllMocks();
        mockBreak.mockResolvedValue();
        mockInvalidate.mockResolvedValue();
        mockSave.mockResolvedValue({ isErr: () => false });
        mockGet.mockReturnValue({ LinkedDevices: { Devices: [device] } });
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
        act(() => root.render(<Harness />));
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });
    it("keeps the local record if server unlinking fails", async () => {
        mockBreak.mockRejectedValue(new Error("Offline"));
        await act(async () => {
            await expect(actions.unlink(device)).rejects.toThrow("Offline");
        });
        expect(mockSave).not.toHaveBeenCalled();
        expect(actions.pendingId).toBeNull();
    });
    it("persists after server success and reports a recoverable local save failure", async () => {
        mockSave.mockResolvedValue({ isErr: () => true });
        await act(async () => {
            await expect(actions.unlink(device)).rejects.toThrow(
                "Linked Devices list was kept",
            );
        });
        expect(mockBreak).toHaveBeenCalledWith({ syncId: "sync" });
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockInvalidate).toHaveBeenCalled();
    });
    it("removes against the latest vault and preserves unrelated links", async () => {
        let result: unknown;
        mockSave.mockImplementation(async (_, mutate) => {
            result = mutate({
                LinkedDevices: { Devices: [device, { ID: "newly-linked" }] },
            });
            return { isErr: () => false };
        });
        await act(async () => {
            await actions.unlink(device);
        });
        expect(result).toMatchObject({
            vault: { LinkedDevices: { Devices: [{ ID: "newly-linked" }] } },
        });
    });
    it("does not call the server for explicit local cleanup", async () => {
        await act(async () => {
            await actions.unlink(device, true);
        });
        expect(mockBreak).not.toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalledTimes(1);
    });
    it("does not call the server for a link using only custom services", async () => {
        const custom = Object.assign({}, device, { official: false });
        mockGet.mockReturnValue({ LinkedDevices: { Devices: [custom] } });
        await act(async () => {
            await actions.unlink(custom);
        });
        expect(mockBreak).not.toHaveBeenCalled();
        expect(mockSave).toHaveBeenCalledTimes(1);
    });
});
