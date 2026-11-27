import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { calculateTOTP, parseTOTPURI, TOTP } from "../vault-utils/vault";

// The iOS AutoFill extension's Swift port reads the same vectors.
const vectors = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "totp-vectors.json"), "utf8"),
) as {
    totp: {
        name: string;
        totp: Pick<TOTP, "Secret" | "Algorithm" | "Digits" | "Period">;
        timestamp: number;
        expected: string | null;
    }[];
    uris: {
        uri: string;
        expected: Pick<
            TOTP,
            "Label" | "Secret" | "Algorithm" | "Digits" | "Period"
        > | null;
    }[];
};

afterEach(() => {
    jest.useRealTimers();
});

describe("shared TOTP vectors", () => {
    it.each(vectors.totp)("$name", ({ totp, timestamp, expected }) => {
        jest.useFakeTimers({ now: timestamp * 1000 });
        let code: string | null = null;
        try {
            code = calculateTOTP(Object.assign(new TOTP(), totp)).code;
        } catch {
            // Invalid secrets throw.
        }
        expect(code).toBe(expected);
    });
});

describe("shared TOTP URI vectors", () => {
    it.each(vectors.uris)("parses $uri", ({ uri, expected }) => {
        let parsed: TOTP | null = null;
        try {
            parsed = parseTOTPURI(uri);
        } catch {
            // Anything but an otpauth://totp link throws.
        }
        expect(parsed && { ...parsed }).toEqual(expected);
    });
});
