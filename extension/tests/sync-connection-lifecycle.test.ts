import { describe, expect, it } from "@jest/globals";

import { WebRTCStatus } from "@/app_lib/synchronization-utils";
import { shouldAutoReconnectAfterWebRTCStatus } from "../src/sync-connection-lifecycle";

describe("extension sync connection lifecycle", () => {
    it("reconnects clean disconnects but not failed connection setup", () => {
        expect(
            shouldAutoReconnectAfterWebRTCStatus(WebRTCStatus.Disconnected),
        ).toBe(true);
        expect(shouldAutoReconnectAfterWebRTCStatus(WebRTCStatus.Failed)).toBe(
            false,
        );
    });
});
