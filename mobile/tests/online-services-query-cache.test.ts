import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { bindOnlineServicesQueryCache } from "@/utils/online-services-query-cache";
import {
    vaultStore,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import { getVaultSessionGeneration } from "@/utils/vault-session";

jest.mock("@/utils/atoms", () => {
    const { atom, createStore } =
        jest.requireActual<typeof import("jotai")>("jotai");
    return {
        vaultStore: createStore(),
        unlockedVaultAtom: atom({ OnlineServices: { DeviceId: "device-a" } }),
        unlockedVaultMetadataAtom: atom({ DBIndex: 1 }),
    };
});
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: jest.fn(() => 1),
}));

const subscriptionKey = ["v1.payment.subscription", undefined];
let client: QueryClient;
let stop: () => void;
beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.mocked(getVaultSessionGeneration).mockReturnValue(1);
    vaultStore.set(unlockedVaultMetadataAtom, { DBIndex: 1 } as VaultMetadata);
    vaultStore.set(unlockedVaultAtom, {
        OnlineServices: { DeviceId: "device-a" },
    } as unknown as Vault);
    stop = bindOnlineServicesQueryCache(client);
    client.setQueryData(subscriptionKey, { nonFree: true });
});
afterEach(() => {
    stop();
    client.clear();
});

it("removes previous-vault membership synchronously before a vault switch returns", () => {
    vaultStore.set(unlockedVaultMetadataAtom, { DBIndex: 2 } as VaultMetadata);
    expect(client.getQueryData(subscriptionKey)).toBeUndefined();
});

it("clears membership when the vault locks", () => {
    vaultStore.set(unlockedVaultMetadataAtom, null);
    expect(client.getQueryData(subscriptionKey)).toBeUndefined();
});

it("clears membership when linking replaces the online-services device within the same vault", () => {
    vaultStore.set(unlockedVaultAtom, {
        ...vaultStore.get(unlockedVaultAtom),
        OnlineServices: { DeviceId: "device-b" },
    } as unknown as Vault);
    expect(client.getQueryData(subscriptionKey)).toBeUndefined();
});

it("keeps membership across ordinary vault edits while invalidating a new unlock generation", () => {
    vaultStore.set(unlockedVaultAtom, {
        ...vaultStore.get(unlockedVaultAtom),
    } as Vault);
    expect(client.getQueryData(subscriptionKey)).toEqual({ nonFree: true });
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    vaultStore.set(unlockedVaultAtom, {
        ...vaultStore.get(unlockedVaultAtom),
    } as Vault);
    expect(client.getQueryData(subscriptionKey)).toBeUndefined();
});

it("cancels a late prior-vault response so it cannot replace the next vault's membership", async () => {
    let resolve!: (value: { nonFree: boolean }) => void;
    const oldQuery = client
        .fetchQuery({
            queryKey: subscriptionKey,
            queryFn: () =>
                new Promise<{ nonFree: boolean }>((r) => {
                    resolve = r;
                }),
        })
        .catch((error: unknown) => error);
    vaultStore.set(unlockedVaultMetadataAtom, { DBIndex: 2 } as VaultMetadata);
    client.setQueryData(subscriptionKey, { nonFree: false });
    resolve({ nonFree: true });
    await oldQuery;
    expect(client.getQueryData(subscriptionKey)).toEqual({ nonFree: false });
});

it("unsubscribes cleanly without clearing the cache on later unrelated store changes", () => {
    stop();
    vaultStore.set(unlockedVaultMetadataAtom, null);
    expect(client.getQueryData(subscriptionKey)).toEqual({ nonFree: true });
});
