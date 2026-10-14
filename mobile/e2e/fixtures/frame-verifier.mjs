export function frameFieldStates(username, password) {
    const state = (actual, expected) => actual === "" ? "empty" : actual === expected ? "matched" : "mismatch";
    return {
        username: state(username, "fixture@example.test"),
        password: state(password, "fixture-password"),
    };
}

export function frameValuesResult(frames) {
    const pairs = [frames.page, frames.visible, frames.offscreen];
    if (pairs.some(pair => !pair || ![pair.username, pair.password].every(value => ["empty", "matched", "mismatch"].includes(value)))) return "loading";
    if (pairs.some(pair => [pair.username, pair.password].includes("mismatch"))) return "mismatch";
    if (pairs.every(pair => pair.username === "empty" && pair.password === "empty")) return "empty";
    if ([frames.page, frames.visible].every(pair => pair.username === "matched" && pair.password === "matched")) return "matched";
    return "incomplete";
}
