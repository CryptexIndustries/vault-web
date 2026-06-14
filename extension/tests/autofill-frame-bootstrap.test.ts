/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it } from "@jest/globals";

import {
    claimAutofillFrameBootstrap,
    clearAutofillFrameBootstrapsForTest,
    registerAutofillFrameBootstrap,
} from "../src/background/autofill-frame-bootstrap";

const sender = (tabId: number, frameId: number): chrome.runtime.MessageSender =>
    ({
        id: "extension-id",
        tab: { id: tabId },
        frameId,
    }) as chrome.runtime.MessageSender;

describe("autofill frame bootstrap registry", () => {
    beforeEach(() => {
        clearAutofillFrameBootstrapsForTest();
    });

    it("lets an extension iframe claim a registered nonce once", () => {
        expect(
            registerAutofillFrameBootstrap(
                {
                    mountId: "mount_1",
                    nonce: "nonce_1",
                    kind: "autofill-menu",
                },
                sender(123, 0),
            ),
        ).toEqual({ ok: true });

        expect(
            claimAutofillFrameBootstrap(
                { mountId: "mount_1", kind: "autofill-menu" },
                sender(123, 7),
            ),
        ).toEqual({ ok: true, nonce: "nonce_1" });

        expect(
            claimAutofillFrameBootstrap(
                { mountId: "mount_1", kind: "autofill-menu" },
                sender(123, 7),
            ),
        ).toEqual({ ok: false, error: "AUTOFILL_FRAME_BOOTSTRAP_NOT_FOUND" });
    });

    it("rejects claims from another tab or iframe kind", () => {
        registerAutofillFrameBootstrap(
            {
                mountId: "mount_2",
                nonce: "nonce_2",
                kind: "autofill-save",
            },
            sender(123, 0),
        );

        expect(
            claimAutofillFrameBootstrap(
                { mountId: "mount_2", kind: "autofill-save" },
                sender(456, 7),
            ),
        ).toEqual({ ok: false, error: "AUTOFILL_FRAME_BOOTSTRAP_MISMATCH" });

        expect(
            claimAutofillFrameBootstrap(
                { mountId: "mount_2", kind: "autofill-menu" },
                sender(123, 7),
            ),
        ).toEqual({ ok: false, error: "AUTOFILL_FRAME_BOOTSTRAP_MISMATCH" });
    });
});
