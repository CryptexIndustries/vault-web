export type PurchasePlan = "monthly" | "yearly";

export class PurchaseRegistrationGate {
    private active = false;
    private armed = true;
    private pending = false;
    private registered = false;

    activate(): void {
        this.active = true;
    }

    cancel(): void {
        this.active = false;
        this.armed = false;
    }

    canAutoRegister(): boolean {
        return this.active && this.armed && !this.pending && !this.registered;
    }

    start(token: string, automatic: boolean): boolean {
        if (!token.trim() || this.pending || this.registered) return false;
        if (automatic && !this.canAutoRegister()) return false;
        this.pending = true;
        this.armed = false;
        return true;
    }

    markRegistered(): void {
        this.registered = true;
    }

    finish(): void {
        this.pending = false;
    }

    retryWithFreshVerification(): boolean {
        if (!this.active || this.pending || this.registered) return false;
        this.armed = true;
        return true;
    }
}

export function readPurchasePlan(search: string): PurchasePlan | null {
    const plan = new URLSearchParams(search).get("plan");
    return plan === "monthly" || plan === "yearly" ? plan : null;
}

// Clear the URL when the account dialog opens so refresh cannot restart checkout.
export function consumePurchasePlanUrl(): void {
    const url = new URL(window.location.href);
    if (!readPurchasePlan(url.search)) return;
    url.searchParams.delete("plan");
    window.history.replaceState(window.history.state, "", url);
}
