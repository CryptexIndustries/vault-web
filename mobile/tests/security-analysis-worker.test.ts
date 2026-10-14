import { expect, it } from "@jest/globals";
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    analyzeCredentialSecurity,
    type SecurityReportCredential,
} from "@cryptex-industries/vault-core/vault-utils/security-report";
import { ItemType } from "@cryptex-industries/vault-core/proto";

const source = JSON.parse(
    readFileSync(
        resolve(__dirname, "../src/workers/security-analysis.generated.json"),
        "utf8",
    ),
);

it("matches the shared report on 320 mixed credentials in an isolated background thread", async () => {
    const now = Date.UTC(2026, 8, 10);
    const credentials: SecurityReportCredential[] = Array.from(
        { length: 320 },
        (_, index) => ({
            ID: String(index),
            Type: index % 19 === 0 ? ItemType.Note : ItemType.Credentials,
            Deleted: index % 23 === 0,
            Name: `Account ${index}`,
            Username: `user${index}`,
            Password:
                index % 17 === 0
                    ? ""
                    : index % 3 === 0
                      ? "password123"
                      : `Q!v${index}#m8-ZeR4-$x${index + 7}`,
            URL: index % 2 ? "https://example.com/login" : "example.org",
            DatePasswordChangedTimestamp:
                now - (index % 2 ? 500 : 5) * 86400000,
        }),
    );
    const worker = new Worker(
        `
        const { parentPort, workerData, threadId } = require('node:worker_threads');
        const vm = require('node:vm');
        const context = vm.createContext({});
        vm.runInContext(workerData.source, context);
        const iterator = context.iterateCredentialSecurityAnalysis(workerData.credentials, workerData.now);
        let step = iterator.next();
        while (!step.done) step = iterator.next();
        parentPort.postMessage({ result: step.value, threadId });
    `,
        { eval: true, workerData: { source, credentials, now } },
    );
    try {
        const response = await new Promise<{
            result: ReturnType<typeof analyzeCredentialSecurity>;
            threadId: number;
        }>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", (code) => {
                if (code) reject(new Error(`Worker exit ${code}`));
            });
        });
        expect(response.threadId).toBeGreaterThan(0);
        expect(response.result).toEqual(
            analyzeCredentialSecurity(credentials, now),
        );
        expect(JSON.stringify(response.result)).not.toContain("password123");
        expect(response.result.reuseGroups.length).toBeGreaterThan(0);
        expect(response.result.weakFindings.length).toBeGreaterThan(0);
        expect(response.result.ageFindings.length).toBeGreaterThan(0);
    } finally {
        await worker.terminate();
    }
}, 30000);
