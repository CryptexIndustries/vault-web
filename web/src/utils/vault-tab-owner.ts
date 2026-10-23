import { unlockedTab } from "@/app_lib/unlocked-tab";
import { unlockedVaultMetadataAtom, vaultStore } from "@/utils/atoms";
import { vaultLog } from "@/utils/logging";
import { getVaultDEKFromSession } from "@/utils/vault-session";

/**
 * Who owns the unlocked vault in this tab (one unlocked tab per browser,
 * see unlocked-tab.ts).
 *
 * The tab claims the Web Lock when it starts to open the vault (an unlock
 * or a new vault), before it reads the vault from storage, and keeps it for
 * as long as anything here can write the vault: an opening still running
 * or waiting for its recovery code to be acknowledged, or a published
 * session (session key or unlocked metadata). Once none is left, it lets
 * go. So a copy this tab decrypts was read while no other tab could change
 * it, and stays the only copy until it is saved and locked.
 *
 * Openings in one tab run one at a time: a new one (Enter pressed twice,
 * another vault picked) cancels the older ones and waits for their storage
 * steps before it reads anything, so an older decrypt's upgrade save can't
 * land on top of a newer session's changes.
 */

/** A decrypted vault is published in this tab, read from the live store. */
function vaultSessionOpen(): boolean {
    return (
        vaultStore.get(unlockedVaultMetadataAtom) !== null ||
        getVaultDEKFromSession().isOk()
    );
}

/** A storage step asked for after its opening was cancelled. */
export class OpeningCancelledError extends Error {
    constructor() {
        super("UNLOCK_CANCELLED");
    }
}

/** One unlock or vault creation, from its claim to its end. */
export class VaultOpening {
    private ended = false;
    private work: Promise<unknown> = Promise.resolve();

    constructor(private readonly owner: VaultTabOwner) {}

    /** Not ended, cancelled or left behind by the page going away. */
    get active(): boolean {
        return !this.ended;
    }

    /**
     * Runs a step that reads or writes the vault (decryption can save an
     * upgrade). The claim outlives it even when the page goes away. Once
     * cancelled, no new step starts.
     */
    run<T>(step: () => Promise<T>): Promise<T> {
        if (this.ended) return Promise.reject(new OpeningCancelledError());
        const running = step();
        this.work = Promise.allSettled([this.work, running]);
        return running;
    }

    /** Resolves once no step started so far is running. */
    async idle(): Promise<void> {
        let seen: Promise<unknown>;
        do {
            seen = this.work;
            await seen;
        } while (seen !== this.work);
    }

    /** Done: published, failed or cancelled. Lets go when nothing else holds. */
    end() {
        this.cancel();
        this.owner.finished(this);
    }

    /** Further results are dropped; the claim stays until end(). */
    cancel() {
        this.ended = true;
    }
}

export class VaultTabOwner {
    private readonly openings = new Set<VaultOpening>();

    constructor() {
        // Every lock or discard ends here: the session closed, let go.
        vaultStore.sub(unlockedVaultMetadataAtom, () => {
            void this.releaseIfClosed();
        });
    }

    /**
     * Claims the tab for an unlock or a new vault, after cancelling older
     * openings here and waiting for their storage steps. Null when another
     * tab has the vault open. Read the vault only after this, and check
     * `active` first: a newer opening or leaving the page may have
     * cancelled this one meanwhile.
     */
    async begin(): Promise<VaultOpening | null> {
        const older = [...this.openings];
        const opening = new VaultOpening(this);
        this.openings.add(opening);
        for (const previous of older) previous.cancel();
        const tabs = unlockedTab();
        const granted = tabs ? await tabs.claim() : true;
        if (!granted) {
            opening.end();
            return null;
        }
        // The claim stays held throughout: this one is in the set. Once
        // idle, a cancelled opening can't touch storage again (run refuses),
        // so ending it here is safe, and frees one left waiting for its
        // recovery code to be acknowledged.
        await Promise.all(older.map((previous) => previous.idle()));
        for (const previous of older) previous.end();
        return opening;
    }

    /** This tab holds the claim (always, without Web Locks). */
    get holds(): boolean {
        const tabs = unlockedTab();
        return !tabs || tabs.holds;
    }

    finished(opening: VaultOpening) {
        if (this.openings.delete(opening)) void this.releaseIfClosed();
    }

    /**
     * The page (/app) went away. Openings still running are cancelled and
     * keep the claim until their storage steps finish. A published session
     * this tab holds the claim for is locked (saved first); one without the
     * claim is discarded unsaved. The claim goes once the session is closed:
     * a failed lock keeps it, so no other tab opens the vault over an
     * unsaved copy.
     */
    async leave({
        lock,
        discard,
    }: {
        lock: () => Promise<unknown>;
        discard: () => Promise<void>;
    }): Promise<void> {
        const left = [...this.openings];
        for (const opening of left) opening.cancel();
        await Promise.all(left.map((opening) => opening.idle()));
        if (vaultSessionOpen()) {
            if (this.holds) await lock();
            else {
                vaultLog.info("Closing a vault this tab didn't own");
                await discard();
            }
        }
        for (const opening of left) opening.end();
        await this.releaseIfClosed();
    }

    private async releaseIfClosed(): Promise<void> {
        if (this.openings.size || vaultSessionOpen()) return;
        await unlockedTab()?.releaseClaim();
    }
}

let shared: VaultTabOwner | null = null;

export function vaultTabOwner(): VaultTabOwner {
    shared ??= new VaultTabOwner();
    return shared;
}
