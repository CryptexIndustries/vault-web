import { decryptResponseEnvelope } from "../src/utils/session-utils";
import type { EncryptedEnvelope } from "../src/types/sw-messaging";

describe("decryptResponseEnvelope", () => {
    it("refuses a response that answers a different request", async () => {
        const result = await decryptResponseEnvelope(
            { requestId: "other-request" } as EncryptedEnvelope,
            "this-request",
        );

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.error).toBe(
            "RESPONSE_REQUEST_MISMATCH",
        );
    });
});
