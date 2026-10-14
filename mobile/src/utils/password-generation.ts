import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english.js";

export type GeneratorType = "random" | "memorable";
export type WordSeparator = "space" | "dash" | "underscore" | "none";

export type GeneratorOptions = {
    type: GeneratorType;
    length: number;
    includeUppercase: boolean;
    includeLowercase: boolean;
    includeNumbers: boolean;
    includeSymbols: boolean;
    wordSeparator: WordSeparator;
};

const RANDOM_SPACE = 0x1_0000_0000;
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";

function randomU32(): number {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return (
        ((bytes[0]! << 24) |
            (bytes[1]! << 16) |
            (bytes[2]! << 8) |
            bytes[3]!) >>>
        0
    );
}

/** A rejected value maps nowhere, so every index has the same input count. */
export function mapUnbiasedIndex(
    value: number,
    count: number,
    sampleSpace = RANDOM_SPACE,
): number | null {
    if (
        !Number.isSafeInteger(value) ||
        !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(sampleSpace) ||
        count < 1 ||
        count > sampleSpace ||
        value < 0 ||
        value >= sampleSpace
    ) {
        throw new RangeError("Invalid random index input");
    }
    const limit = Math.floor(sampleSpace / count) * count;
    return value < limit ? value % count : null;
}

export function randomIndex(
    count: number,
    draw: () => number = randomU32,
): number {
    while (true) {
        const index = mapUnbiasedIndex(draw(), count);
        if (index !== null) return index;
    }
}

/** Rejection of whole strings makes every password with all enabled classes equally likely. */
export function generateRandomPassword(
    options: GeneratorOptions,
    draw: () => number = randomU32,
): string {
    const classes = [
        options.includeLowercase && LOWERCASE,
        options.includeUppercase && UPPERCASE,
        options.includeNumbers && NUMBERS,
        options.includeSymbols && SYMBOLS,
    ].filter((value): value is string => Boolean(value));
    if (classes.length === 0) return "";
    if (options.length < classes.length) {
        throw new RangeError(
            "Password length is shorter than the enabled character classes",
        );
    }
    const alphabet = classes.join("");
    while (true) {
        let password = "";
        for (let position = 0; position < options.length; position++) {
            password += alphabet[randomIndex(alphabet.length, draw)];
        }
        if (
            classes.every((characters) =>
                [...password].some((character) =>
                    characters.includes(character),
                ),
            )
        ) {
            return password;
        }
    }
}

export function generateMemorablePassphrase(
    options: GeneratorOptions,
    draw: () => number = randomU32,
): string {
    const words: string[] = [];
    for (let index = 0; index < options.length; index++) {
        let word = englishWordlist[randomIndex(englishWordlist.length, draw)]!;
        if (options.includeUppercase && randomIndex(2, draw) === 1) {
            word = word.charAt(0).toUpperCase() + word.slice(1);
        }
        if (options.includeNumbers && randomIndex(10, draw) > 6) {
            word += randomIndex(10, draw).toString();
        }
        words.push(word);
    }
    const separator =
        options.wordSeparator === "space"
            ? " "
            : options.wordSeparator === "dash"
              ? "-"
              : options.wordSeparator === "underscore"
                ? "_"
                : "";
    return words.join(separator);
}

export function generatePassword(options: GeneratorOptions): string {
    return options.type === "random"
        ? generateRandomPassword(options)
        : generateMemorablePassphrase(options);
}
