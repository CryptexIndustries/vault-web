/**
 * One dashboard tab at a time runs the SSH agent approver: the relay keeps
 * one approver connection per device and drops the older one when another
 * signs in, so two tabs would push each other off. A Web Lock elects the
 * tab; when it closes, locks or gives up, the next waiting tab takes over.
 */

/** The part of navigator.locks this uses. */
export type LockManagerLike = {
    request(
        name: string,
        options: { signal?: AbortSignal; steal?: boolean },
        callback: (lock: unknown) => Promise<void>,
    ): Promise<unknown>;
};

type LeadershipHandlers = {
    /** This tab holds the lock now. */
    onAcquired: () => void;
    /** It released the lock, or another tab took it. */
    onLost: () => void;
};

export class TabLeadership {
    private wanted = false;
    private held = false;
    /** Identifies the newest request, so stale grants let go at once. */
    private attempt = 0;
    private abort: AbortController | null = null;
    private releaseHeld: (() => void) | null = null;
    private waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

    constructor(
        private readonly name: string,
        private readonly locks: LockManagerLike | undefined,
        private readonly handlers: LeadershipHandlers,
    ) {}

    get isLeader(): boolean {
        return this.held;
    }

    /**
     * Asks to lead and resolves once this tab does. Without steal it waits
     * behind the tab that leads now; with steal (the user is acting in this
     * tab) it takes over at once.
     */
    request(steal = false): Promise<void> {
        this.wanted = true;
        if (this.held) return Promise.resolve();
        const acquired = new Promise<void>((resolve, reject) =>
            this.waiters.push({ resolve, reject }),
        );
        if (!this.locks) {
            // No Web Locks (very old browsers): lead alone.
            this.grant();
            return acquired;
        }
        if (this.abort && !steal) return acquired;
        this.abort?.abort();
        const attempt = ++this.attempt;
        // A signal can't be combined with steal; a stolen grant that is no
        // longer wanted is released right away instead.
        const abort = steal ? null : new AbortController();
        this.abort = abort;
        this.locks
            .request(
                this.name,
                abort ? { signal: abort.signal } : { steal: true },
                async () => {
                    if (attempt !== this.attempt || !this.wanted) return;
                    this.abort = null;
                    await new Promise<void>((release) => {
                        this.releaseHeld = release;
                        this.grant();
                    });
                },
            )
            .catch(() => {
                // Aborted by relinquish(), or stolen by another tab.
            })
            .finally(() => {
                if (attempt !== this.attempt) return;
                const wasHeld = this.held;
                this.held = false;
                this.releaseHeld = null;
                if (this.abort === abort) this.abort = null;
                if (!wasHeld) return;
                this.handlers.onLost();
                // Taken by another tab while this one still wants to lead:
                // wait for it to finish.
                if (this.wanted) void this.request().catch(() => undefined);
            });
        return acquired;
    }

    /** Stops leading, or stops waiting to; pending request()s reject. */
    relinquish(): void {
        this.wanted = false;
        const stopped = new Error("This tab stopped running the approver");
        for (const waiter of this.waiters.splice(0)) waiter.reject(stopped);
        this.attempt++;
        this.abort?.abort();
        this.abort = null;
        const release = this.releaseHeld;
        this.releaseHeld = null;
        if (!this.held) return;
        this.held = false;
        release?.();
        this.handlers.onLost();
    }

    private grant(): void {
        this.held = true;
        this.handlers.onAcquired();
        for (const waiter of this.waiters.splice(0)) waiter.resolve();
    }
}
