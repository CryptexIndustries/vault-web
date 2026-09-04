const SCRIPT_ESCAPE_PATTERN = /[<>&\u2028\u2029]/g;
const SCRIPT_ESCAPES: Record<string, string> = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
};

/** Serialize public configuration as a standalone, inert JavaScript asset. */
export function createRuntimeConfigScript(config: unknown): string {
    const serialized = JSON.stringify(config).replace(
        SCRIPT_ESCAPE_PATTERN,
        (character) => SCRIPT_ESCAPES[character] ?? character,
    );

    return `globalThis.__CRYPTEX_RUNTIME_CONFIG__=Object.freeze(${serialized});\n`;
}
