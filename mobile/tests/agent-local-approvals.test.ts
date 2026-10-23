import { describe, expect, it, jest } from "@jest/globals";

const mockStore = new Map<string, { value: string; options: unknown }>();

jest.mock("@react-native-async-storage/async-storage", () => ({}));
jest.mock("expo-secure-store", () => ({
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "after-first-unlock-this-device",
    getItemAsync: async (key: string) => mockStore.get(key)?.value ?? null,
    setItemAsync: async (key: string, value: string, options: unknown) => {
        mockStore.set(key, { value, options });
    },
    deleteItemAsync: async (key: string) => {
        mockStore.delete(key);
    },
}));

const { localApprovals } =
    require("@/agent/agent-storage") as typeof import("@/agent/agent-storage");

describe("agents this phone paired", () => {
    it("live in secure storage, readable while the vault is locked", async () => {
        await localApprovals.save([{ agentId: "a1", keys: ["AAAA"] }]);
        const [entry] = [...mockStore.values()];
        expect(entry?.options).toEqual({
            keychainAccessible: "after-first-unlock-this-device",
        });
        expect(await localApprovals.load()).toEqual([
            { agentId: "a1", keys: ["AAAA"] },
        ]);
    });

    it("ignore malformed entries and clear when empty", async () => {
        const [key] = [...mockStore.keys()];
        mockStore.set(key!, {
            value: JSON.stringify([
                { agentId: "a1", keys: ["AAAA"] },
                { agentId: 3, keys: [] },
                { agentId: "a2", keys: [1] },
            ]),
            options: {},
        });
        expect(await localApprovals.load()).toEqual([
            { agentId: "a1", keys: ["AAAA"] },
        ]);
        await localApprovals.save([]);
        expect(mockStore.size).toBe(0);
        expect(await localApprovals.load()).toEqual([]);
    });
});
