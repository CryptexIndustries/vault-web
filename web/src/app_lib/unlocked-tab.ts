/**
 * The vault stays unlocked in one dashboard tab per browser. Each tab holds
 * its own decrypted copy and saves all of it, so two unlocked tabs would
 * overwrite each other's changes (and the SSH agent approver in one of
 * them would answer from a stale copy). A tab takes a Web Lock before it
 * reads the vault to unlock it and keeps it until it locks; other tabs see
 * it held and offer "Use here", which asks that tab, over a
 * BroadcastChannel, to lock through its normal lock path (so its save runs
 * first). The user then unlocks again here: no keys pass between tabs.
 */

export const UNLOCKED_TAB_LOCK = "cryptex-vault-unlocked-tab";
export const TABS_CHANNEL = "cryptex-vault-tabs";

/** The part of navigator.locks this uses. */
export type TabLockManager = {
    request(
        name: string,
        options: { ifAvailable?: boolean },
        callback: (lock: unknown) => Promise<void>,
    ): Promise<unknown>;
    query?(): Promise<{ held?: { name?: string }[] }>;
};

export type TabChannel = {
    postMessage(message: unknown): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close(): void;
};

type TabMessage = { type: "changed" | "release" };

export class UnlockedTabCoordinator {
    private release: (() => void) | null = null;
    private request: Promise<unknown> | null = null;
    /** A claim waiting for the browser's grant. */
    private claiming: Promise<boolean> | null = null;
    /** Bumped by releaseClaim, so a grant arriving later is let go at once. */
    private generation = 0;
    private releaseHandler: (() => void) | null = null;
    private readonly listeners = new Set<() => void>();

    constructor(
        private readonly locks: TabLockManager | undefined,
        private readonly channel: TabChannel | null,
    ) {
        if (channel)
            channel.onmessage = ({ data }) => {
                const type = (data as Partial<TabMessage> | null)?.type;
                if (type === "release") {
                    if (this.release) this.releaseHandler?.();
                } else if (type === "changed") {
                    for (const listener of this.listeners) listener();
                }
            };
    }

    /** This tab has the vault open. */
    get holds(): boolean {
        return this.release !== null;
    }

    /**
     * Claims the one unlocked tab, before an unlock or vault creation reads
     * anything (vault-tab-owner.ts). False when another tab has the vault
     * open already. Browsers without Web Locks always get it.
     */
    claim(): Promise<boolean> {
        if (this.release || !this.locks) return Promise.resolve(true);
        if (this.claiming) return this.claiming;
        const claiming = this.requestClaim().finally(() => {
            if (this.claiming === claiming) this.claiming = null;
        });
        this.claiming = claiming;
        return claiming;
    }

    private async requestClaim(): Promise<boolean> {
        const generation = this.generation;
        const granted = await new Promise<boolean>((resolve) => {
            this.request = this.locks!.request(
                UNLOCKED_TAB_LOCK,
                { ifAvailable: true },
                async (lock) => {
                    // Released before the browser granted it: let go now.
                    if (!lock || generation !== this.generation)
                        return resolve(false);
                    await new Promise<void>((done) => {
                        this.release = done;
                        resolve(true);
                    });
                },
            ).catch(() => resolve(false));
        });
        if (granted) this.post({ type: "changed" });
        return granted;
    }

    /**
     * The vault locked in this tab: another tab may open it now. Also
     * cancels a claim still waiting for its grant.
     */
    async releaseClaim(): Promise<void> {
        this.generation++;
        this.claiming = null;
        const release = this.release;
        if (!release) return;
        this.release = null;
        release();
        // Tell the others once the browser has let go of the lock.
        await this.request;
        this.request = null;
        this.post({ type: "changed" });
    }

    /**
     * Another tab in this browser has the vault open (or is opening it).
     * False while this tab holds or is claiming the lock: the holder seen
     * then is this tab.
     */
    async otherTabOpen(): Promise<boolean> {
        const mine = () => this.release !== null || this.claiming !== null;
        if (mine() || !this.locks?.query) return false;
        try {
            const state = await this.locks.query();
            return (
                !mine() &&
                (state.held ?? []).some(
                    (lock) => lock.name === UNLOCKED_TAB_LOCK,
                )
            );
        } catch {
            return false;
        }
    }

    /** "Use here": the tab that has the vault open locks it. */
    requestRelease(): void {
        this.post({ type: "release" });
    }

    /** Called when another tab asks this one to lock. */
    setReleaseHandler(handler: () => void): () => void {
        this.releaseHandler = handler;
        return () => {
            if (this.releaseHandler === handler) this.releaseHandler = null;
        };
    }

    /** Called when a tab opened or locked the vault. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private post(message: TabMessage) {
        try {
            this.channel?.postMessage(message);
        } catch {
            // A closed channel (the page is going away).
        }
    }
}

let shared: UnlockedTabCoordinator | null = null;

/** This tab's coordinator; null during server rendering. */
export function unlockedTab(): UnlockedTabCoordinator | null {
    if (typeof window === "undefined") return null;
    shared ??= new UnlockedTabCoordinator(
        (navigator as Navigator & { locks?: TabLockManager }).locks,
        typeof BroadcastChannel === "undefined"
            ? null
            : (new BroadcastChannel(TABS_CHANNEL) as unknown as TabChannel),
    );
    return shared;
}
