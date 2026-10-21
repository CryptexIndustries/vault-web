/**
 * @jest-environment jsdom
 *
 * Who owns the unlocked vault on /app (vault-tab-owner.ts). The tab claims
 * the one-tab Web Lock before it reads the vault, keeps it while the vault
 * is open, and leaving the page closes whatever the live store holds, so
 * no decrypted copy outlives its claim or is read while another tab could
 * change it.
 */
import "../helpers/jsdom-encoding";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "jotai";
import { err, ok } from "neverthrow";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    isVaultUnlockedAtom,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import { UnlockedTabCoordinator } from "@/app_lib/unlocked-tab";
import { FakeTabLocks } from "../helpers/fake-locks";
import {
    clearVaultDEKFromSession,
    getVaultDEKFromSession,
} from "@/utils/vault-session";
import { lockUnlockedVault } from "@/utils/vault-lock";
import { persistVaultMutation } from "@/utils/vault-mutations";
import AppIndex from "@/pages/app";

type UnlockResult = {
    isOk(): boolean;
    isErr(): boolean;
    error?: string;
    value?: {
        pendingUnlock?: { metadata: unknown; vault: Vault; dek: unknown };
    };
};
type CreateResult =
    | false
    | { pendingUnlock: { metadata: unknown; vault: Vault; dek: unknown } };
type ManagerProps = {
    tryDecryptVaultCallback: (
        metadata: unknown,
        formData: unknown,
    ) => Promise<UnlockResult>;
    tryCreateVaultCallback: (formData: unknown) => Promise<CreateResult>;
    finalizeVaultUnlockCallback: (
        metadata: unknown,
        vault: Vault,
        dek: unknown,
    ) => void;
};

const mockState: {
    tabs: UnlockedTabCoordinator | null;
    manager: ManagerProps | null;
    /** The database, by DBIndex: what a fresh read returns. */
    stored: Map<number, unknown>;
    createNewVault: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
} = {
    tabs: null,
    manager: null,
    stored: new Map(),
    createNewVault: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

jest.mock("@/app_lib/unlocked-tab", () => ({
    ...jest.requireActual<typeof import("@/app_lib/unlocked-tab")>(
        "@/app_lib/unlocked-tab",
    ),
    unlockedTab: () => mockState.tabs,
}));
jest.mock("@/components/vault-manager/layout", () => ({
    __esModule: true,
    default: (props: ManagerProps) => {
        mockState.manager = props;
        return null;
    },
}));
jest.mock("@/components/vault-dashboard/vault-dashboard", () => ({
    VaultDashboard: () => null,
}));
jest.mock("@/components/vault-open-elsewhere", () => ({
    VaultOpenElsewhere: () => <div data-testid="vault-open-elsewhere" />,
}));
jest.mock("@/components/html-header", () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock("@/components/html-main", () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/app_lib/vault-utils/storage", () => ({
    VaultMetadata: {
        load: async (dbIndex: number) => mockState.stored.get(dbIndex) ?? null,
        createNewVault: (...args: unknown[]) =>
            mockState.createNewVault(...args),
    },
}));
// index.tsx imports these through the "src/" path, which Jest doesn't map.
jest.mock(
    "src/app_lib/auth-session",
    () => ({
        establishPremiumSession: jest.fn(),
        syncOnlineServicesRemoteConfiguration: jest.fn(),
    }),
    { virtual: true },
);
jest.mock(
    "src/utils/logging",
    () => ({ onlineServicesLog: { error: jest.fn() } }),
    { virtual: true },
);
jest.mock("@/app_lib/auth-session", () => ({
    logoutOnlineServicesSession: jest.fn(async () => undefined),
    establishPremiumSession: jest.fn(),
    syncOnlineServicesRemoteConfiguration: jest.fn(),
}));
jest.mock("@/app_lib/managed-backup-hooks", () => ({
    flushManagedBackupBeforeLock: jest.fn(async () => undefined),
    stopManagedBackup: jest.fn(),
    markManagedBackupDirty: jest.fn(),
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => false,
}));
jest.mock("sonner", () => ({ toast: { info: jest.fn(), error: jest.fn() } }));

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () =>
    act(async () => {
        for (let i = 0; i < 5; i++)
            await new Promise((resolve) => setTimeout(resolve, 0));
    });

function deferred<T = void>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const dek = { type: "secret" };
const formData = {
    Secret: "pw",
    Encryption: 0,
    EncryptionKeyDerivationFunction: 0,
    EncryptionConfig: {},
};

/** Stored metadata whose decryption waits for finish(). */
function storedVault(dbIndex = 1) {
    const decrypting = deferred<unknown>();
    const meta = {
        DBIndex: dbIndex,
        decryptVault: jest.fn(() => decrypting.promise),
        save: jest.fn(
            async (_vault: unknown, _dek: unknown): Promise<void> => undefined,
        ),
        finish: (vault = new Vault(), extra: object = {}) =>
            decrypting.resolve(ok({ vault, dek, ...extra })),
        fail: () => decrypting.resolve(err("BAD_PASSWORD")),
    };
    mockState.stored.set(dbIndex, meta);
    return meta;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let locks = new FakeTabLocks();

afterEach(async () => {
    await act(async () => root?.unmount());
    await settle();
    container?.remove();
    root = null;
    container = null;
    vaultStore.set(unlockedVaultMetadataAtom, null);
    vaultStore.set(unlockedVaultAtom, new Vault());
    clearVaultDEKFromSession();
    await mockState.tabs?.releaseClaim();
    mockState.stored.clear();
    mockState.manager = null;
    strict = false;
    jest.clearAllMocks();
});

/** StrictMode at the root: nested inside the Provider, React skips the extra mount cycle. */
let strict = false;
const render = (node: React.ReactNode) => {
    const tree = <Provider store={vaultStore}>{node}</Provider>;
    return act(async () =>
        root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree),
    );
};

async function mount({ strictMode = false } = {}) {
    strict = strictMode;
    locks = new FakeTabLocks();
    mockState.tabs = new UnlockedTabCoordinator(locks, null);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render(<AppIndex />);
    await settle();
}

/** Starts an unlock of the vault the list shows (maybe an older copy). */
async function begin(selected: unknown) {
    let unlocking: Promise<UnlockResult> | undefined;
    await act(async () => {
        unlocking = mockState.manager!.tryDecryptVaultCallback(
            selected,
            formData,
        );
    });
    await settle();
    // Wrapped: an async function would wait for the unlock itself.
    return { unlocking: unlocking! };
}

async function finish(
    meta: ReturnType<typeof storedVault>,
    { unlocking }: { unlocking: Promise<UnlockResult> },
    vault = new Vault(),
    extra: object = {},
) {
    let result: UnlockResult | undefined;
    await act(async () => {
        meta.finish(vault, extra);
        result = await unlocking;
    });
    await settle();
    return result!;
}

const otherTab = () => new UnlockedTabCoordinator(locks, null);
const lockOptions = (metadata: unknown) => ({
    unlockedVaultMetadata: metadata as never,
    setUnlockedVault: async (
        value: Vault | ((previous: Vault) => Vault | Promise<Vault>),
    ) =>
        vaultStore.set(
            unlockedVaultAtom,
            typeof value === "function"
                ? await value(vaultStore.get(unlockedVaultAtom))
                : value,
        ),
    setUnlockedVaultMetadata: (value: unknown) =>
        vaultStore.set(unlockedVaultMetadataAtom, value as never),
});
const closed = () =>
    !vaultStore.get(isVaultUnlockedAtom) && getVaultDEKFromSession().isErr();

describe("unlocking /app", () => {
    it("publishes an unlock that finishes on the page, under the claim", async () => {
        await mount();
        const meta = storedVault();
        const unlocking = await begin(meta);
        expect(mockState.tabs!.holds).toBe(true);
        expect((await finish(meta, unlocking)).isOk()).toBe(true);
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(true);
        expect(getVaultDEKFromSession().isOk()).toBe(true);
        expect(mockState.tabs!.holds).toBe(true);
    });

    it("drops an unlock that finishes after the page went away, then lets go", async () => {
        await mount();
        const meta = storedVault();
        const unlocking = await begin(meta);
        await render(null);
        await settle();
        // Still decrypting (it may save an upgrade): the claim stays.
        expect(mockState.tabs!.holds).toBe(true);
        expect(await otherTab().claim()).toBe(false);
        const result = await finish(meta, unlocking);
        expect(result.error).toBe("UNLOCK_CANCELLED");
        expect(closed()).toBe(true);
        expect(mockState.tabs!.holds).toBe(false);
        expect(meta.save).not.toHaveBeenCalled();
    });

    it("cancels an unlock from an old page instance", async () => {
        await mount();
        const meta = storedVault();
        const unlocking = await begin(meta);
        await render(null);
        await render(<AppIndex />);
        await settle();
        expect((await finish(meta, unlocking)).error).toBe("UNLOCK_CANCELLED");
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(false);
        expect(mockState.tabs!.holds).toBe(false);
    });

    it("lets the latest of two pending unlocks win", async () => {
        await mount();
        const a = storedVault(1);
        const b = storedVault(2);
        const first = await begin(a);
        const second = await begin(b);
        expect((await finish(a, first)).error).toBe("UNLOCK_CANCELLED");
        // The newer unlock still needs the claim.
        expect(mockState.tabs!.holds).toBe(true);
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(false);
        expect((await finish(b, second)).isOk()).toBe(true);
        expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(b);
        expect(mockState.tabs!.holds).toBe(true);
    });

    // Enter pressed twice starts two decrypts of one vault: the older one's
    // upgrade save mustn't land after the newer session saved an edit and
    // locked, restoring the old copy.
    it("runs a second unlock in this tab only after the first one's storage work", async () => {
        await mount();
        const writes: unknown[] = [];
        const older = storedVault();
        const stale = new Vault();
        // decryptVault saves an upgrade before it returns.
        const decryptOlder = older.decryptVault.getMockImplementation()!;
        older.decryptVault.mockImplementation(async () => {
            const result = (await decryptOlder()) as {
                value: { vault: Vault };
            };
            writes.push(result.value.vault);
            return result;
        });
        const first = await begin(older);
        expect(older.decryptVault).toHaveBeenCalledTimes(1);
        // What a fresh read returns from here on.
        const newer = storedVault();
        newer.save.mockImplementation(async (vault: unknown) => {
            writes.push(vault);
        });
        const second = await begin(newer);
        // Waits: the older decrypt may still save.
        expect(newer.decryptVault).not.toHaveBeenCalled();
        expect((await finish(older, first, stale)).error).toBe(
            "UNLOCK_CANCELLED",
        );
        expect(writes).toEqual([stale]);
        expect(newer.decryptVault).toHaveBeenCalledTimes(1);
        expect((await finish(newer, second)).isOk()).toBe(true);
        const edited = new Vault();
        await act(async () => {
            const saved = await persistVaultMutation(
                "credential.delete",
                () => ({
                    vault: edited,
                    result: undefined,
                }),
            );
            expect(saved.isOk()).toBe(true);
        });
        await act(async () => {
            expect((await lockUnlockedVault(lockOptions(newer))).isOk()).toBe(
                true,
            );
        });
        await settle();
        // Nothing older lands after the edit.
        expect(writes.at(-1)).toBe(edited);
        expect(closed()).toBe(true);
        expect(mockState.tabs!.holds).toBe(false);
    });

    it("ends an older opening still waiting for its recovery code when a new one starts", async () => {
        await mount();
        const older = storedVault();
        const revealed = await finish(older, await begin(older), new Vault(), {
            revealSecrets: { recoveryCode: "test" },
        });
        expect(revealed.isOk()).toBe(true);
        const newer = storedVault();
        const second = await begin(newer);
        await act(async () => {
            newer.fail();
            await second.unlocking;
        });
        await settle();
        // Neither holds the claim now; the old acknowledgement publishes nothing.
        expect(mockState.tabs!.holds).toBe(false);
        const pending = revealed.value!.pendingUnlock!;
        await act(async () =>
            mockState.manager!.finalizeVaultUnlockCallback(
                pending.metadata,
                pending.vault,
                pending.dek,
            ),
        );
        expect(closed()).toBe(true);
    });

    it("lets go after a failed unlock, and a retry claims again", async () => {
        await mount();
        const a = storedVault();
        const first = await begin(a);
        await act(async () => {
            a.fail();
            expect((await first.unlocking).isErr()).toBe(true);
        });
        await settle();
        expect(mockState.tabs!.holds).toBe(false);
        expect(getVaultDEKFromSession().isOk()).toBe(false);
        const b = storedVault();
        expect((await finish(b, await begin(b))).isOk()).toBe(true);
        expect(mockState.tabs!.holds).toBe(true);
    });

    it("keeps the claim while the recovery code shows, and ignores an acknowledgement after leaving", async () => {
        await mount();
        const meta = storedVault();
        const finalize = mockState.manager!.finalizeVaultUnlockCallback;
        const result = await finish(meta, await begin(meta), new Vault(), {
            revealSecrets: { recoveryCode: "test" },
        });
        expect(result.isOk()).toBe(true);
        expect(getVaultDEKFromSession().isOk()).toBe(false);
        expect(mockState.tabs!.holds).toBe(true);
        await render(null);
        await settle();
        expect(mockState.tabs!.holds).toBe(false);
        const pending = result.value!.pendingUnlock!;
        await act(async () =>
            finalize(pending.metadata, pending.vault, pending.dek),
        );
        expect(closed()).toBe(true);
    });

    it("creates a vault under the claim and publishes it once acknowledged", async () => {
        await mount();
        const created = {
            metadata: storedVault(),
            vault: new Vault(),
            dek,
            revealSecrets: { recoveryCode: "test" },
        };
        mockState.createNewVault.mockImplementation(async () => {
            // Nothing is written before the claim.
            expect(mockState.tabs!.holds).toBe(true);
            return created;
        });
        let result = false as CreateResult;
        await act(async () => {
            result = await mockState.manager!.tryCreateVaultCallback({
                Name: "new",
                ...formData,
            });
        });
        expect(created.metadata.save).toHaveBeenCalledWith(null, dek);
        expect(getVaultDEKFromSession().isOk()).toBe(false);
        expect(mockState.tabs!.holds).toBe(true);
        const pending = (result as Exclude<CreateResult, false>).pendingUnlock;
        await act(async () =>
            mockState.manager!.finalizeVaultUnlockCallback(
                pending.metadata,
                pending.vault,
                pending.dek,
            ),
        );
        await settle();
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(true);
        expect(mockState.tabs!.holds).toBe(true);
    });

    it("locks, lets go, and unlocks again", async () => {
        await mount();
        const meta = storedVault();
        await finish(meta, await begin(meta));
        await act(async () => {
            expect((await lockUnlockedVault(lockOptions(meta))).isOk()).toBe(
                true,
            );
        });
        await settle();
        expect(mockState.tabs!.holds).toBe(false);
        expect(closed()).toBe(true);
        const again = storedVault();
        expect((await finish(again, await begin(again))).isOk()).toBe(true);
        expect(mockState.tabs!.holds).toBe(true);
    });

    it("keeps the vault open through React's strict-mode remount", async () => {
        // The extra mount cycle leaves and remounts at once: the page is
        // still live for the unlock, and the leave never runs.
        await mount({ strictMode: true });
        const meta = storedVault();
        expect((await finish(meta, await begin(meta))).isOk()).toBe(true);
        await settle();
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(true);
        expect(mockState.tabs!.holds).toBe(true);
        expect(meta.save).not.toHaveBeenCalled();
    });
});

describe("another tab", () => {
    it("having the vault open stops an unlock before it reads anything", async () => {
        await mount();
        const b = otherTab();
        expect(await b.claim()).toBe(true);
        const meta = storedVault();
        const result = await (await begin(meta)).unlocking;
        expect(result.error).toBe("VAULT_OPEN_ELSEWHERE");
        expect(meta.decryptVault).not.toHaveBeenCalled();
        expect(
            document.querySelector("[data-testid=vault-open-elsewhere]"),
        ).not.toBeNull();
        expect(closed()).toBe(true);
        await b.releaseClaim();
    });

    // B mustn't open, edit and close the vault while A decrypts an older
    // snapshot that A then saves over B.
    it("can't open the vault while this tab decrypts, and this tab decrypts what is stored now", async () => {
        await mount();
        const listed = storedVault();
        // Another tab saved a newer copy after the list was read.
        const newest = storedVault();
        const unlocking = await begin(listed);
        expect(listed.decryptVault).not.toHaveBeenCalled();
        expect(newest.decryptVault).toHaveBeenCalledTimes(1);
        expect(await otherTab().claim()).toBe(false);
        expect((await finish(newest, unlocking)).isOk()).toBe(true);
        expect(vaultStore.get(unlockedVaultMetadataAtom)).toBe(newest);
    });
});

describe("leaving /app", () => {
    // The unlock publishes and the page goes away in the same batch, before
    // any effect ran.
    it("locks a vault published in the same batch as the navigation, then lets go", async () => {
        await mount();
        const meta = storedVault();
        const stale = new Vault();
        const unlocking = await begin(meta);
        await act(async () => {
            meta.finish(stale);
            expect((await unlocking.unlocking).isOk()).toBe(true);
            root!.render(<Provider store={vaultStore}>{null}</Provider>);
        });
        await settle();
        expect(meta.save).toHaveBeenCalledWith(stale, dek);
        expect(closed()).toBe(true);
        expect(mockState.tabs!.holds).toBe(false);
        // Another tab may open it now; coming back finds it locked.
        const b = otherTab();
        expect(await b.claim()).toBe(true);
        await b.releaseClaim();
        await render(<AppIndex />);
        await settle();
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(false);
        expect(mockState.tabs!.holds).toBe(false);
    });

    it("closes an unlock when the navigation was queued first in the same batch", async () => {
        await mount();
        const meta = storedVault();
        const unlocking = await begin(meta);
        await act(async () => {
            root!.render(<Provider store={vaultStore}>{null}</Provider>);
            meta.finish();
            await unlocking.unlocking;
        });
        await settle();
        expect(closed()).toBe(true);
        expect(mockState.tabs!.holds).toBe(false);
    });

    it("keeps the claim when the lock on leaving fails", async () => {
        await mount();
        const meta = storedVault();
        await finish(meta, await begin(meta));
        meta.save.mockRejectedValue(new Error("disk full"));
        await render(null);
        await settle();
        expect(vaultStore.get(isVaultUnlockedAtom)).toBe(true);
        expect(mockState.tabs!.holds).toBe(true);
        expect(await otherTab().claim()).toBe(false);
    });

    // A second lock queued behind the running one would find the session
    // closed, fail, and keep the claim.
    it("shares a lock already running, and lets go once it finishes", async () => {
        await mount();
        const meta = storedVault();
        await finish(meta, await begin(meta));
        const saving = deferred();
        meta.save.mockImplementation(() => saving.promise);
        let locking: Promise<{ isOk(): boolean }> | undefined;
        await act(async () => {
            locking = lockUnlockedVault(lockOptions(meta));
        });
        await render(null);
        await settle();
        await act(async () => {
            saving.resolve();
            expect((await locking!).isOk()).toBe(true);
        });
        await settle();
        expect(meta.save).toHaveBeenCalledTimes(1);
        expect(closed()).toBe(true);
        expect(mockState.tabs!.holds).toBe(false);
        const b = otherTab();
        expect(await b.claim()).toBe(true);
        await b.releaseClaim();
    });
});
