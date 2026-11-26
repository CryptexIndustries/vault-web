import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    generateMemorablePassphrase,
    generateRandomPassword,
    type GeneratorOptions,
} from "@/utils/password-generation";

// The iOS AutoFill extension's Swift generator reads the same vectors.
const { vectors } = JSON.parse(
    readFileSync(
        join(
            __dirname,
            "../targets/AutofillCoreTests/Fixtures/generator-vectors.json",
        ),
        "utf8",
    ),
) as {
    vectors: {
        name: string;
        options: GeneratorOptions;
        seed: number;
        prefix?: number[];
        expected: string;
    }[];
};

/** The prefix, then xorshift32 from the seed, so both sides draw the same numbers. */
function draws(seed: number, prefix: number[] = []) {
    const queue = [...prefix];
    let state = (seed * 2654435761) % 4294967296 || 2463534242;
    return () => {
        const next = queue.shift();
        if (next !== undefined) return next;
        state = (state ^ (state << 13)) >>> 0;
        state ^= state >>> 17;
        state = (state ^ (state << 5)) >>> 0;
        return state;
    };
}

describe("shared password generator vectors", () => {
    it.each(vectors)("$name", ({ options, seed, prefix, expected }) => {
        const generate =
            options.type === "random"
                ? generateRandomPassword
                : generateMemorablePassphrase;
        expect(generate(options, draws(seed, prefix))).toBe(expected);
    });
});
