import { describe, expect, it } from "@jest/globals";

import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import { hasValidServerSelections } from "@/utils/send-link-server-validation";

describe("hasValidServerSelections", () => {
    const customSignaling = [{ ID: "sig-1" }];
    const customStun = [{ ID: "stun-1" }];
    const customTurn = [{ ID: "turn-1" }];

    it("accepts cloud Online Services selections with STUN or TURN", () => {
        expect(
            hasValidServerSelections(
                true,
                ONLINE_SERVICES_SELECTION_ID,
                [ONLINE_SERVICES_SELECTION_ID],
                [],
                customSignaling,
                customStun,
                customTurn,
            ),
        ).toBe(true);

        expect(
            hasValidServerSelections(
                true,
                ONLINE_SERVICES_SELECTION_ID,
                [],
                [ONLINE_SERVICES_SELECTION_ID],
                customSignaling,
                customStun,
                customTurn,
            ),
        ).toBe(true);
    });

    it("accepts custom signaling with either a STUN or TURN path", () => {
        expect(
            hasValidServerSelections(
                false,
                "sig-1",
                ["stun-1"],
                ["turn-1"],
                customSignaling,
                customStun,
                customTurn,
            ),
        ).toBe(true);

        expect(
            hasValidServerSelections(
                false,
                "sig-1",
                ["stun-1"],
                [],
                customSignaling,
                customStun,
                customTurn,
            ),
        ).toBe(true);

        expect(
            hasValidServerSelections(
                false,
                "sig-1",
                [],
                ["turn-1"],
                customSignaling,
                customStun,
                customTurn,
            ),
        ).toBe(true);

        expect(
            hasValidServerSelections(
                false,
                "",
                ["stun-1"],
                ["turn-1"],
                customSignaling,
                customStun,
                customTurn,
            ),
        ).toBe(false);
    });
});
