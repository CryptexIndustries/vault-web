/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";

import { VaultWriteCoordinator } from "../../src/app_lib/vault-utils/vault-write-coordinator";

describe("VaultWriteCoordinator", () => {
    it("runs writes in submission order", async () => {
        const coordinator = new VaultWriteCoordinator();
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = coordinator.run("credential.upsert", async () => {
            events.push("first:start");
            await firstGate;
            events.push("first:end");
        });
        const second = coordinator.run("credential.delete", async () => {
            events.push("second:start");
            events.push("second:end");
        });

        await Promise.resolve();
        expect(events).toEqual(["first:start"]);

        releaseFirst();
        await Promise.all([first, second]);

        expect(events).toEqual([
            "first:start",
            "first:end",
            "second:start",
            "second:end",
        ]);
    });

    it("continues after a failed write", async () => {
        const coordinator = new VaultWriteCoordinator();
        const failure = coordinator.run("credential.upsert", async () => {
            throw new Error("save failed");
        });
        const success = coordinator.run("credential.delete", async () => 42);

        await expect(failure).rejects.toThrow("save failed");
        await expect(success).resolves.toBe(42);
    });
});
