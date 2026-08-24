import { test as base, chromium, type BrowserContext } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

type ExtensionFixtures = {
    context: BrowserContext;
    extensionId: string;
};

export const test = base.extend<ExtensionFixtures>({
    context: async ({ browserName }, use) => {
        if (browserName !== "chromium") {
            throw new Error("Browser extension E2E tests require Chromium");
        }
        const extensionPath = path.resolve(currentDirectory, "../dist");
        const userDataDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "cryptex-vault-e2e-"),
        );
        const context = await chromium.launchPersistentContext(userDataDir, {
            channel: "chromium",
            headless: !process.env.PWDEBUG,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
        });

        await use(context);

        await context.close();
        await fs.rm(userDataDir, { recursive: true, force: true });
    },

    extensionId: async ({ context }, use) => {
        let [serviceWorker] = context.serviceWorkers();
        serviceWorker ??= await context.waitForEvent("serviceworker");
        const extensionId = new URL(serviceWorker.url()).host;
        await use(extensionId);
    },
});

export { expect } from "@playwright/test";
