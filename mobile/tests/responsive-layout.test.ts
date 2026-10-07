import { describe, expect, it } from "@jest/globals";

import { isTabletViewport } from "../src/theme/layout";

describe("responsive layout", () => {
    it("does not turn a phone into a tablet rail when rotated", () => {
        expect(isTabletViewport(844, 390)).toBe(false);
        expect(isTabletViewport(390, 844)).toBe(false);
    });

    it("keeps a tablet layout in either orientation", () => {
        expect(isTabletViewport(1024, 768)).toBe(true);
        expect(isTabletViewport(768, 1024)).toBe(true);
    });
});
