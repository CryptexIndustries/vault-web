/**
 * @jest-environment jsdom
 */
import "../helpers/jsdom-encoding";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { sshFixture } from "../helpers/ssh-fixtures";
import { SSH_KEY_TASK_INTERNAL_ERROR } from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import {
    runSSHKeyTask,
    type SSHKeyTask,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";

/** Stands in for the browser Worker; the test drives its events. */
class MockWorker {
    static instances: MockWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    onerror: ((event: { preventDefault: () => void }) => void) | null = null;
    posted: SSHKeyTask[] = [];
    terminated = false;

    constructor() {
        MockWorker.instances.push(this);
    }

    postMessage(task: SSHKeyTask) {
        this.posted.push(task);
    }

    terminate() {
        this.terminated = true;
    }

    /** Answers the posted task the way the real worker would. */
    respond() {
        this.onmessage?.({ data: runSSHKeyTask(this.posted[0]!) });
    }
}

const mockCreateWorker = jest.fn(() => new MockWorker());
jest.mock("@/utils/ssh-key-worker", () => ({
    createSSHKeyWorker: () => mockCreateWorker(),
}));

import { runSSHKeyTaskInWorker } from "@/utils/ssh-key";

const importTask: SSHKeyTask = {
    kind: "import",
    text: sshFixture("ed25519.key"),
};
const internal = {
    ok: false,
    code: "internal",
    message: SSH_KEY_TASK_INTERNAL_ERROR,
};
const globals = globalThis as { Worker?: unknown };

/** Lets the client's dynamic import settle and start its worker. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runSSHKeyTaskInWorker", () => {
    afterEach(() => {
        delete globals.Worker;
        MockWorker.instances = [];
        mockCreateWorker.mockClear();
    });

    it("runs on the main thread where there are no workers", async () => {
        const result = await runSSHKeyTaskInWorker(importTask);
        expect(result).toEqual(runSSHKeyTask(importTask));
        expect(result.ok && result.kind === "import").toBe(true);
        expect(mockCreateWorker).not.toHaveBeenCalled();
    });

    describe("with workers", () => {
        beforeEach(() => {
            globals.Worker = MockWorker;
        });

        it("posts the task and resolves with the worker's result", async () => {
            const running = runSSHKeyTaskInWorker(importTask);
            await flush();
            const [worker] = MockWorker.instances;
            expect(worker!.posted).toEqual([importTask]);
            worker!.respond();

            expect(await running).toEqual(runSSHKeyTask(importTask));
            expect(worker!.terminated).toBe(true);
        });

        it.each<[string, (worker: MockWorker) => void]>([
            [
                "crashes",
                (worker) => {
                    const preventDefault = jest.fn();
                    worker.onerror?.({ preventDefault });
                    // Keeps the crash out of the console as an uncaught error.
                    expect(preventDefault).toHaveBeenCalled();
                },
            ],
            [
                "sends a message it can't read",
                (worker) => worker.onmessage?.({ data: "garbage" }),
            ],
            [
                "sends a message that can't be decoded",
                (worker) => worker.onmessageerror?.(),
            ],
        ])(
            "resolves to the internal error when the worker %s",
            async (_, fail) => {
                const running = runSSHKeyTaskInWorker(importTask);
                await flush();
                const [worker] = MockWorker.instances;
                fail(worker!);

                expect(await running).toEqual(internal);
                expect(worker!.terminated).toBe(true);
            },
        );

        it("resolves to the internal error when the worker can't start", async () => {
            mockCreateWorker.mockImplementationOnce(() => {
                throw new Error("blocked by CSP");
            });
            expect(await runSSHKeyTaskInWorker(importTask)).toEqual(internal);
        });

        it("terminates the worker when aborted", async () => {
            const controller = new AbortController();
            const running = runSSHKeyTaskInWorker(importTask, {
                signal: controller.signal,
            });
            await flush();
            const [worker] = MockWorker.instances;
            controller.abort();

            expect(await running).toEqual(internal);
            expect(worker!.terminated).toBe(true);
            // A late answer from the terminated worker changes nothing.
            worker!.respond();
        });

        it("doesn't start a worker for a run aborted before it began", async () => {
            const controller = new AbortController();
            controller.abort();
            expect(
                await runSSHKeyTaskInWorker(importTask, {
                    signal: controller.signal,
                }),
            ).toEqual(internal);
            expect(mockCreateWorker).not.toHaveBeenCalled();
        });
    });
});
