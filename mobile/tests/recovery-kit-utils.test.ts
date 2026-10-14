import { describe, expect, it } from "@jest/globals";

import {
    RECOVERY_PHRASE_WORD_COUNT,
    buildRecoveryKitCopyText,
    buildRecoveryKitPrintHtml,
    countRecoveryPhraseWords,
    joinRecoveryPhrase,
    normalizeRecoveryWord,
    splitRecoveryPhrase,
    splitRecoveryPhraseIntoSlots,
} from "@ui/lib/recovery-kit-utils";

describe("recovery phrase helpers", () => {
    const phrase =
        "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual";

    it("normalizes and counts words", () => {
        expect(normalizeRecoveryWord("  Abandon ")).toBe("abandon");
        expect(countRecoveryPhraseWords(phrase)).toBe(
            RECOVERY_PHRASE_WORD_COUNT,
        );
        expect(splitRecoveryPhrase(phrase)).toHaveLength(
            RECOVERY_PHRASE_WORD_COUNT,
        );
    });

    it("splits into fixed slots and joins", () => {
        const slots = splitRecoveryPhraseIntoSlots("one two", 4);
        expect(slots).toEqual(["one", "two", "", ""]);
        expect(joinRecoveryPhrase(["One", "TWO", "", ""], 4)).toBe("one two");
    });

    it("builds kit copy text without dropping either field", () => {
        const text = buildRecoveryKitCopyText("user-123", phrase);
        expect(text).toContain("user-123");
        expect(text).toContain(phrase);
        expect(text).toContain("Recovery phrase:");
    });

    it("escapes account and phrase content in the printable kit", () => {
        const html = buildRecoveryKitPrintHtml(
            '<script>alert("user")</script>',
            "one <img> &two",
        );
        expect(html).toContain(
            "&lt;script&gt;alert(&quot;user&quot;)&lt;/script&gt;",
        );
        expect(html).toContain("&lt;img&gt;");
        expect(html).toContain("&amp;two");
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<img>");
    });
});
