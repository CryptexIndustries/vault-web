/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";

import { VaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

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

    it("captures snapshots between writes without allowing interleaving", async () => {
        const coordinator = new VaultWriteCoordinator();
        const events: string[] = [];
        let releaseSnapshot!: () => void;
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });

        const first = coordinator.run("credential.upsert", async () => {
            events.push("write-1");
        });
        const snapshot = coordinator.runSnapshot(async () => {
            events.push("snapshot:start");
            await snapshotGate;
            events.push("snapshot:end");
        });
        const second = coordinator.run("credential.delete", async () => {
            events.push("write-2");
        });

        await first;
        await Promise.resolve();
        expect(events).toEqual(["write-1", "snapshot:start"]);

        releaseSnapshot();
        await Promise.all([snapshot, second]);
        expect(events).toEqual([
            "write-1",
            "snapshot:start",
            "snapshot:end",
            "write-2",
        ]);
    });
});
