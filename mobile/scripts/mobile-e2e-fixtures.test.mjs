import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import yaml from "js-yaml";

const directory = new URL("../e2e/flows/", import.meta.url);
const flows = new Map(readdirSync(directory).filter(name => name.endsWith(".yaml")).map(name => {
    const [config, steps] = yaml.loadAll(readFileSync(new URL(name, directory), "utf8"));
    assert.ok(["${CRYPTEX_APP_ID}", "com.cryptex.autofillfixture", "com.android.chrome", "com.android.settings"].includes(config.appId), name);
    assert.ok(Array.isArray(steps), `${name} must contain Maestro commands`);
    return [name, steps];
}));
const flatten = steps => steps.flatMap(step => [step,
    ...flatten(step.runFlow?.commands ?? []), ...flatten(step.repeat?.commands ?? [])]);

test("every Maestro fixture parses and each shared flow reference exists", () => {
    for (const [name, steps] of flows) {
        for (const step of flatten(steps)) {
            const reference = typeof step.runFlow === "string" ? step.runFlow : step.runFlow?.file;
            if (typeof reference !== "string") continue;
            assert.ok(existsSync(new URL(reference, directory)), `${name}: ${reference}`);
        }
    }
});

test("all fixture master-password fields use the shared vault-creation password", () => {
    const setup = flatten(flows.get("setup-vault.yaml"));
    const creation = setup.findIndex(step => step.tapOn === "Master password");
    const expected = setup.slice(creation + 1).find(step => Object.hasOwn(step, "inputText")).inputText;
    assert.equal(typeof expected, "string");
    for (const [name, commands] of flows) {
        const steps = flatten(commands);
        for (const [index, step] of steps.entries()) {
            const label = typeof step.tapOn === "string" ? step.tapOn : step.tapOn?.id;
            if (!["Master password", "Enter master password", "confirm-master-password",
                "Confirm vault password for biometric unlock"].includes(label)) continue;
            const nextInput = steps.slice(index + 1).find(candidate => Object.hasOwn(candidate, "inputText"));
            // This restore journey intentionally proves a wrong password cannot
            // expose an exported item before retrying the shared correct password.
            const wrongRestorePassword = name === "restore-export.yaml" &&
                label === "Master password" && nextInput?.inputText === "WrongPassword42";
            if (wrongRestorePassword) {
                assert.ok(steps.some(candidate => candidate.assertNotVisible === "E2E Transfer Login.*"));
            } else {
                const fixturePassword = ["sync-link-receiver.yaml", "sync-linked-verify.yaml"].includes(name)
                    ? "ReceiverHorseBatteryStaple42" : expected;
                assert.equal(nextInput?.inputText, fixturePassword, `${name}: ${label}`);
            }
        }
    }
});
