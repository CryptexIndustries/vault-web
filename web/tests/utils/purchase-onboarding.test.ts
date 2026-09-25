import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
    consumePurchasePlanUrl,
    PurchaseRegistrationGate,
    readPurchasePlan,
} from "@/utils/purchase-onboarding";

afterEach(() => {
    window.history.replaceState(null, "", "/");
});

describe("purchase plan handoff", () => {
    it.each(["monthly", "yearly"] as const)(
        "reads the %s plan and removes only that URL parameter",
        (plan) => {
            window.history.replaceState(
                null,
                "",
                `/app?plan=${plan}&source=pricing#vault`,
            );
            expect(readPurchasePlan(window.location.search)).toBe(plan);

            consumePurchasePlanUrl();
            expect(
                window.location.pathname +
                    window.location.search +
                    window.location.hash,
            ).toBe("/app?source=pricing#vault");
            expect(readPurchasePlan(window.location.search)).toBeNull();
        },
    );

    it("ignores invalid plans and leaves ordinary app use unchanged", () => {
        expect(readPurchasePlan("")).toBeNull();
        expect(readPurchasePlan("?plan=enterprise")).toBeNull();
    });
});

describe("purchase registration", () => {
    it("starts once on verification and requires an explicit fresh verification after failure", () => {
        const gate = new PurchaseRegistrationGate();
        const register = jest.fn();
        gate.activate();
        if (gate.start("first-token", true)) register("first-token");
        if (gate.start("first-token", true)) register("first-token");
        expect(register).toHaveBeenCalledTimes(1);

        gate.finish(); // server rejected the first attempt
        expect(gate.start("first-token", true)).toBe(false);
        expect(gate.retryWithFreshVerification()).toBe(true);
        if (gate.start("second-token", true)) register("second-token");
        gate.markRegistered();
        gate.finish();
        expect(register).toHaveBeenCalledTimes(2);
        expect(register).toHaveBeenLastCalledWith("second-token");
        expect(gate.retryWithFreshVerification()).toBe(false);
        expect(gate.start("third-token", true)).toBe(false);
    });

    it("stops registration after cancellation and clears the URL for refresh", () => {
        const gate = new PurchaseRegistrationGate();
        gate.activate();
        gate.cancel();
        expect(gate.start("token", true)).toBe(false);
        expect(gate.retryWithFreshVerification()).toBe(false);
        window.history.replaceState(null, "", "/app?plan=monthly");
        consumePurchasePlanUrl();
        expect(readPurchasePlan(window.location.search)).toBeNull();
    });
});
