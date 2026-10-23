/**
 * Request IDs denied from a notification, kept for 3 minutes. A Deny can
 * arrive before its request does: after a reboot or a swipe-away the agent
 * resends the request once the relay reconnects, and the fresh runtime has no
 * memory of the answer. A remembered ID is refused without asking again.
 */

export const DENIED_MEMORY_MS = 3 * 60_000;
const MAX_DENIED = 64;

export class DeniedRequests {
    private ids = new Map<string, number>();

    constructor(private readonly now: () => number = Date.now) {}

    private prune() {
        const now = this.now();
        for (const [id, at] of this.ids)
            if (now - at > DENIED_MEMORY_MS || now < at) this.ids.delete(id);
        while (this.ids.size > MAX_DENIED)
            this.ids.delete(this.ids.keys().next().value!);
    }

    add(id: string) {
        this.ids.delete(id);
        this.ids.set(id, this.now());
        this.prune();
    }

    has(id: string): boolean {
        this.prune();
        return this.ids.has(id);
    }
}

export const deniedRequests = new DeniedRequests();
