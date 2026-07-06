import { describe, it, expect } from "@jest/globals";

import { ONLINE_SERVICES_SELECTION_ID } from "../src/utils/consts";
import { hasValidServerSelections } from "../src/components/vault-dashboard/send-link-server-validation";

const ONLINE = ONLINE_SERVICES_SELECTION_ID;

const signalingServers = [{ ID: "sig-1" }];
const stunServers = [{ ID: "stun-1" }];
const turnServers = [{ ID: "turn-1" }];

describe("hasValidServerSelections", () => {
    describe("non-cloud mode (custom servers only)", () => {
        it("accepts TURN-only with no STUN server", () => {
            // Per RFC 8656 a TURN server also fulfills the STUN role.
            expect(
                hasValidServerSelections(
                    false,
                    "sig-1",
                    [],
                    ["turn-1"],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(true);
        });

        it("accepts both custom STUN and TURN", () => {
            expect(
                hasValidServerSelections(
                    false,
                    "sig-1",
                    ["stun-1"],
                    ["turn-1"],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(true);
        });

        it("rejects STUN-only (no TURN) because Online Services relay fallback is unavailable", () => {
            expect(
                hasValidServerSelections(
                    false,
                    "sig-1",
                    ["stun-1"],
                    [],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(false);
        });

        it("rejects when neither STUN nor TURN is selected", () => {
            expect(
                hasValidServerSelections(
                    false,
                    "sig-1",
                    [],
                    [],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(false);
        });

        it("rejects an unknown TURN server id", () => {
            expect(
                hasValidServerSelections(
                    false,
                    "sig-1",
                    [],
                    ["turn-missing"],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(false);
        });

        it("rejects an empty signaling server id", () => {
            expect(
                hasValidServerSelections(
                    false,
                    "",
                    [],
                    ["turn-1"],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(false);
        });
    });

    describe("cloud mode (Online Services available)", () => {
        it("accepts the default Online Services selection for everything", () => {
            expect(
                hasValidServerSelections(
                    true,
                    ONLINE,
                    [ONLINE],
                    [ONLINE],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(true);
        });

        it("accepts TURN-only with Online Services TURN and no STUN", () => {
            expect(
                hasValidServerSelections(
                    true,
                    ONLINE,
                    [],
                    [ONLINE],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(true);
        });

        it("accepts STUN-only with Online Services STUN and no TURN", () => {
            expect(
                hasValidServerSelections(
                    true,
                    ONLINE,
                    [ONLINE],
                    [],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(true);
        });

        it("accepts a custom TURN server with no STUN", () => {
            expect(
                hasValidServerSelections(
                    true,
                    ONLINE,
                    [],
                    ["turn-1"],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(true);
        });

        it("rejects when neither STUN nor TURN is selected", () => {
            expect(
                hasValidServerSelections(
                    true,
                    ONLINE,
                    [],
                    [],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(false);
        });

        it("rejects an empty signaling server id when no custom server matches", () => {
            expect(
                hasValidServerSelections(
                    true,
                    "",
                    [ONLINE],
                    [ONLINE],
                    signalingServers,
                    stunServers,
                    turnServers,
                ),
            ).toBe(false);
        });
    });
});
