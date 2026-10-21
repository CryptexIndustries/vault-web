/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";

import {
    TabLeadership,
    type LockManagerLike,
} from "../../src/app_lib/agent/tab-leadership";
import { FakeLocks } from "../helpers/fake-locks";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function tab(locks: LockManagerLike | undefined, log: string[], name: string) {
    return new TabLeadership("approver", locks, {
        onAcquired: () => log.push(`${name} leads`),
        onLost: () => log.push(`${name} stops`),
    });
}

function twoTabs() {
    const locks = new FakeLocks();
    const log: string[] = [];
    return { log, a: tab(locks, log, "a"), b: tab(locks, log, "b") };
}

describe("approver tab election", () => {
    it("lets one tab lead and hands over when it gives up", async () => {
        const { log, a, b } = twoTabs();
        await a.request();
        void b.request();
        await settle();
        expect(log).toEqual(["a leads"]);
        expect(b.isLeader).toBe(false);

        a.relinquish();
        await settle();
        expect(log).toEqual(["a leads", "a stops", "b leads"]);
        expect(a.isLeader).toBe(false);
        expect(b.isLeader).toBe(true);
    });

    it("takes over at once on steal, and the other tab waits to lead again", async () => {
        const { log, a, b } = twoTabs();
        await a.request();
        await b.request(true);
        await settle();
        expect(log).toEqual(["a leads", "b leads", "a stops"]);
        expect(a.isLeader).toBe(false);

        b.relinquish();
        await settle();
        expect(log.slice(3)).toEqual(["b stops", "a leads"]);
        expect(a.isLeader).toBe(true);
    });

    it("stops waiting when it no longer wants to lead", async () => {
        const { log, a, b } = twoTabs();
        await a.request();
        const waiting = b.request().catch((error: Error) => error.message);
        b.relinquish();
        expect(await waiting).toMatch(/stopped/);
        a.relinquish();
        await settle();
        expect(log).toEqual(["a leads", "a stops"]);
        expect(b.isLeader).toBe(false);
    });

    it("releases a stolen grant that is no longer wanted", async () => {
        const { log, a, b } = twoTabs();
        await a.request();
        const stealing = b.request(true).catch(() => undefined);
        b.relinquish();
        await stealing;
        await settle();
        // a lost the lock to the steal, got it back once b let go.
        expect(log).toEqual(["a leads", "a stops", "a leads"]);
        expect(a.isLeader).toBe(true);
        expect(b.isLeader).toBe(false);
    });

    it("leads alone without Web Locks", async () => {
        const log: string[] = [];
        const a = tab(undefined, log, "a");
        await a.request();
        expect(a.isLeader).toBe(true);
        a.relinquish();
        expect(log).toEqual(["a leads", "a stops"]);
    });
});
