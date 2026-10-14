import { describe, expect, it } from "@jest/globals";
import {
    generateMemorablePassphrase,
    generateRandomPassword,
    mapUnbiasedIndex,
    randomIndex,
    type GeneratorOptions,
} from "@/utils/password-generation";

const options: GeneratorOptions = {
    type: "random",
    length: 16,
    includeLowercase: true,
    includeUppercase: true,
    includeNumbers: true,
    includeSymbols: true,
    wordSeparator: "space",
};

function seededDraw(seed: number): () => number {
    let state = seed;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
    };
}

describe("unbiased password generation", () => {
    it.each([3, 5, 7, 10, 26, 90])(
        "maps every accepted byte equally for alphabet size %i",
        (count) => {
            const frequencies = Array<number>(count).fill(0);
            for (let byte = 0; byte < 256; byte++) {
                const index = mapUnbiasedIndex(byte, count, 256);
                if (index !== null) frequencies[index]++;
            }
            expect(new Set(frequencies).size).toBe(1);
            expect(frequencies[0]).toBe(Math.floor(256 / count));
        },
    );

    it("retries rejected random values", () => {
        const values = [0xffff_ffff, 5];
        expect(randomIndex(10, () => values.shift()!)).toBe(5);
        expect(values).toHaveLength(0);
    });

    it("has no measurable index skew in a fixed-seed sample", () => {
        const draw = seededDraw(0x1234_5678);
        const counts = Array<number>(26).fill(0);
        for (let index = 0; index < 26_000; index++) {
            counts[randomIndex(26, draw)]++;
        }
        const chiSquared = counts.reduce(
            (sum, count) => sum + (count - 1_000) ** 2 / 1_000,
            0,
        );
        expect(chiSquared).toBeLessThan(50);
    });

    it("does not pin required character classes to fixed positions", () => {
        const draw = seededDraw(0x0bad_cafe);
        const counts = [0, 0, 0, 0];
        for (let index = 0; index < 1_000; index++) {
            const first = generateRandomPassword(
                { ...options, length: 4 },
                draw,
            )[0]!;
            counts[
                /[a-z]/.test(first)
                    ? 0
                    : /[A-Z]/.test(first)
                      ? 1
                      : /[0-9]/.test(first)
                        ? 2
                        : 3
            ]++;
        }
        for (const count of counts) {
            expect(count).toBeGreaterThan(180);
            expect(count).toBeLessThan(320);
        }
    });

    it("always includes each enabled character class", () => {
        for (let index = 0; index < 200; index++) {
            const password = generateRandomPassword({ ...options, length: 4 });
            expect(password).toMatch(/[a-z]/);
            expect(password).toMatch(/[A-Z]/);
            expect(password).toMatch(/[0-9]/);
            expect(password).toMatch(/[^a-zA-Z0-9]/);
            expect(password).toHaveLength(4);
        }
    });

    it("rejects a length shorter than the enabled classes", () => {
        expect(() => generateRandomPassword({ ...options, length: 3 })).toThrow(
            RangeError,
        );
    });

    it("generates the requested number of memorable words", () => {
        const phrase = generateMemorablePassphrase({
            ...options,
            type: "memorable",
            length: 4,
            includeUppercase: false,
            includeNumbers: false,
        });
        expect(phrase.split(" ")).toHaveLength(4);
    });
});
