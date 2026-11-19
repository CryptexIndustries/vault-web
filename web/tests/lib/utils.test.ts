import { describe, it, expect } from "@jest/globals";

import { cn } from "../../src/lib/utils";

describe("cn (Tailwind class merge)", () => {
    it("concatenates plain class names", () => {
        expect(cn("a", "b")).toBe("a b");
    });

    it("filters out falsy values", () => {
        expect(cn("a", false, null, undefined, "b")).toBe("a b");
    });

    it("dedupes/merges conflicting tailwind utilities", () => {
        const merged = cn("p-2", "p-4");
        expect(merged).toBe("p-4");
    });

    it("returns empty string for no inputs", () => {
        expect(cn()).toBe("");
    });
});
