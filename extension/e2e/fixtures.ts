import {
    test as base,
    chromium,
    expect as playwrightExpect,
    type BrowserContext,
} from "@playwright/test";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { garageHostResolverRules, garageS3Url } from "../../e2e/garage/garage";
import { firefoxExecutable } from "../scripts/install-firefox.mjs";
import { FirefoxContext, FirefoxLocator } from "./firefox/browser";
import { expectFirefoxLocator } from "./firefox/expect";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const headless = process.env.CRYPTEX_E2E_HEADED !== "1";

const FIREFOX_EXTENSION_UUID = "6f0c2a4e-1b7d-4c3e-9a55-0d1e2f3a4b5c";

type ExtensionFixtures = {
    context: BrowserContext;
    extensionId: string;
};

function launchChromium(userDataDir: string) {
    const extensionPath = path.resolve(currentDirectory, "../dist");
    return chromium.launchPersistentContext(userDataDir, {
        channel: "chromium",
        headless,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            `--host-resolver-rules=${garageHostResolverRules(garageS3Url)}`,
            // The e2e Garage's https certificate comes from a test CA.
            "--ignore-certificate-errors",
        ],
    });
}

function launchFirefox(userDataDir: string) {
    const executablePath =
        process.env.CRYPTEX_FIREFOX_PATH ?? firefoxExecutable;
    if (!existsSync(executablePath)) {
        throw new Error(
            `No Firefox at ${executablePath}. Run pnpm test:e2e:install:firefox or set CRYPTEX_FIREFOX_PATH.`,
        );
    }
    return FirefoxContext.launch({
        executablePath,
        userDataDir,
        headless,
        extensionPath: path.resolve(currentDirectory, "../dist-firefox"),
        extensionUuid: FIREFOX_EXTENSION_UUID,
        // Sends garage.e2e and its bucket subdomains to the e2e Garage.
        prefs: { "network.dns.forceResolve": new URL(garageS3Url).hostname },
    });
}

export const test = base.extend<ExtensionFixtures>({
    context: async ({ browserName }, use, testInfo) => {
        const userDataDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "cryptex-vault-e2e-"),
        );
        let context: BrowserContext | FirefoxContext | undefined;
        try {
            context =
                browserName === "firefox"
                    ? await launchFirefox(userDataDir)
                    : await launchChromium(userDataDir);
            // The Firefox driver has the part of the API the specs use.
            await use(context as BrowserContext);
        } finally {
            if (
                context instanceof FirefoxContext &&
                testInfo.status !== testInfo.expectedStatus
            ) {
                const log = testInfo.outputPath("firefox.log");
                await fs.writeFile(log, context.bidi.logs.join("\n"));
                await testInfo.attach("firefox.log", { path: log });
            }
            if (context) {
                try {
                    await context.close();
                } catch {
                    // The test or browser process may have already closed it.
                }
            }
            await fs.rm(userDataDir, { recursive: true, force: true });
        }
    },

    extensionId: async ({ context }, use) => {
        // The Firefox driver opens chrome-extension://<id>/ URLs as
        // moz-extension://<id>/.
        if ((context as unknown) instanceof FirefoxContext) {
            await use(FIREFOX_EXTENSION_UUID);
            return;
        }
        let [serviceWorker] = context.serviceWorkers();
        serviceWorker ??= await context.waitForEvent("serviceworker");
        const extensionId = new URL(serviceWorker.url()).host;
        await use(extensionId);
    },
});

/** Playwright's expect, which also takes the Firefox driver's locators. */
export const expect = new Proxy(playwrightExpect, {
    apply(target, thisArg, [actual, ...rest]) {
        return actual instanceof FirefoxLocator
            ? expectFirefoxLocator(actual)
            : Reflect.apply(target, thisArg, [actual, ...rest]);
    },
});
