import { expect, test } from "@playwright/test";

const apiOrigin = "http://localhost:3001";
const deviceId = "purchase-e2e-device";
const userId = "purchase-e2e-user";

for (const firstRegistrationFails of [false, true]) {
    test(`yearly plan reaches checkout ${firstRegistrationFails ? "after registration retry" : "after vault and account recovery acknowledgements"}`, async ({
        page,
        request,
        baseURL,
    }) => {
        const runtimeConfig = await (
            await request.get("/runtime-config.js")
        ).text();
        test.skip(
            !runtimeConfig.includes('"NEXT_PUBLIC_CLOUD_ENABLED":true'),
            "Run against a web server with Online Services enabled and E2E_EXTERNAL_SERVER=1.",
        );

        let registrations = 0;
        let recoveryGenerations = 0;
        let checkoutTier: string | null = null;
        const unexpected: string[] = [];
        const registrationPublicKeys: string[] = [];
        let recoveryCreated = false;

        await page.route(
            "https://challenges.cloudflare.com/turnstile/v0/api.js**",
            (route) =>
                route.fulfill({
                    contentType: "application/javascript",
                    body: `window.turnstile={render:(_element,options)=>{window.__turnstileRenderCount=(window.__turnstileRenderCount||0)+1;window.__solvePurchaseTurnstile=()=>options.callback("e2e-token");return "e2e-widget"},remove(){},reset(){}};window.onloadTurnstileCallback?.();`,
                }),
        );
        await page.route("https://js.stripe.com/**", (route) => route.abort());
        await page.route(`${apiOrigin}/api/trpc/**`, async (route) => {
            const req = route.request();
            const headers = {
                "access-control-allow-origin": new URL(baseURL!).origin,
                "access-control-allow-methods": "GET, POST, OPTIONS",
                "access-control-allow-headers":
                    "authorization, content-type, trpc-accept",
                "content-type": "application/json",
            };
            if (req.method() === "OPTIONS") {
                await route.fulfill({ status: 204, headers });
                return;
            }

            const url = new URL(req.url());
            const paths = url.pathname.split("/api/trpc/")[1]!.split(",");
            const input = JSON.parse(
                req.method() === "POST"
                    ? req.postData() || "{}"
                    : url.searchParams.get("input") || "{}",
            ) as Record<
                string,
                { json?: { tier?: string; publicKeyJWK?: string } }
            >;
            const results = paths.map((path, index) => {
                let data: unknown;
                switch (path) {
                    case "v1.auth.register":
                        registrations++;
                        registrationPublicKeys.push(
                            input[String(index)]?.json?.publicKeyJWK ?? "",
                        );
                        if (firstRegistrationFails && registrations === 1) {
                            return {
                                error: {
                                    json: {
                                        message: "Could not create account.",
                                        code: -32603,
                                        data: {
                                            code: "INTERNAL_SERVER_ERROR",
                                            httpStatus: 500,
                                            path,
                                        },
                                    },
                                },
                            };
                        }
                        data = { deviceId, userId };
                        break;
                    case "v1.auth.challenge":
                        data = {
                            challengeId: "purchase-e2e-challenge",
                            challenge: btoa("purchase-e2e-challenge"),
                            expiresAt: Date.now() + 60_000,
                        };
                        break;
                    case "v1.auth.verify":
                        data = {
                            sessionToken: "purchase-e2e-session",
                            refreshToken: "purchase-e2e-refresh",
                            expiresAt: Date.now() + 3_600_000,
                            refreshExpiresAt: Date.now() + 86_400_000,
                        };
                        break;
                    case "v1.user.configuration":
                        data = {
                            deviceId,
                            root: false,
                            canLink: false,
                            maxLinks: 0,
                            canPromoteDevices: false,
                            managedEncryptedBackups: false,
                            passwordSharing: false,
                            securityReportBasic: true,
                            securityReportAdvanced: false,
                            recoveryTokenCreatedAt: null,
                            recoveryGenerationNeeded: !recoveryCreated,
                        };
                        break;
                    case "v1.user.generateRecoveryToken":
                        recoveryGenerations++;
                        recoveryCreated = true;
                        data = {
                            userId,
                            token: Array(24).fill("abandon").join(" "),
                        };
                        break;
                    case "v1.payment.subscription":
                        data = {
                            productName: "Free",
                            status: "active",
                            nonFree: false,
                            resourceStatus: { linkedDevices: 0 },
                        };
                        break;
                    case "v1.backup.status":
                        data = {
                            enabled: false,
                            entitled: false,
                            storageConfigured: false,
                            recoveryConfigured: false,
                        };
                        break;
                    case "v1.payment.checkoutSession":
                        checkoutTier = input[String(index)]?.json?.tier ?? null;
                        data = "cs_test_purchase_e2e_placeholder";
                        break;
                    default:
                        unexpected.push(path);
                        data = null;
                }
                return { result: { data: { json: data } } };
            });
            await route.fulfill({
                status: 200,
                headers,
                body: JSON.stringify(
                    url.searchParams.get("batch") === "1"
                        ? results
                        : results[0],
                ),
            });
        });

        await page.goto("/pricing");
        await page.getByRole("button", { name: /Annually/ }).click();
        await page
            .getByRole("link", { name: "Continue with yearly plan" })
            .click();
        await expect(page).toHaveURL(/\/app\?plan=yearly$/);
        await expect(
            page.getByPlaceholder("Enter your new vault name"),
        ).toHaveValue("Main vault");
        await page
            .getByPlaceholder("Enter your secret key")
            .fill("e2e-correct-horse-battery-staple-42!");
        await page.getByRole("button", { name: "Create Vault" }).click();

        const vaultRecovery = page.getByRole("dialog", {
            name: "Save these secrets now",
        });
        await vaultRecovery
            .getByLabel("I have written down the recovery code")
            .check();
        await vaultRecovery.getByRole("button", { name: "Continue" }).click();

        const account = page.getByRole("dialog", {
            name: "Account",
            exact: true,
        });
        await expect(account).toBeVisible();
        await expect(
            page.getByRole("dialog", { name: "Action required" }),
        ).toHaveCount(0);
        await expect(
            account.getByText(
                "Completing verification creates an Online Services account",
                { exact: false },
            ),
        ).toBeVisible();
        await page.evaluate(() =>
            (
                window as typeof window & {
                    __solvePurchaseTurnstile: () => void;
                }
            ).__solvePurchaseTurnstile(),
        );
        if (firstRegistrationFails) {
            await account
                .getByRole("button", {
                    name: "Retry with fresh verification",
                })
                .click();
            await expect
                .poll(() =>
                    page.evaluate(
                        () =>
                            (
                                window as typeof window & {
                                    __turnstileRenderCount: number;
                                }
                            ).__turnstileRenderCount,
                    ),
                )
                .toBe(2);
            await page.evaluate(() =>
                (
                    window as typeof window & {
                        __solvePurchaseTurnstile: () => void;
                    }
                ).__solvePurchaseTurnstile(),
            );
        }
        const kit = page.getByRole("dialog", {
            name: "Save your Recovery Kit",
        });
        await expect(kit).toBeVisible();
        expect(registrations).toBe(firstRegistrationFails ? 2 : 1);
        expect(new Set(registrationPublicKeys).size).toBe(1);
        expect(registrationPublicKeys[0]).toBeTruthy();
        expect(recoveryGenerations).toBe(1);
        expect(checkoutTier).toBeNull();

        await kit.getByRole("button", { name: "Download kit" }).click();
        await kit
            .getByLabel(
                "I saved my User ID and recovery phrase in a secure offline location.",
            )
            .check();
        await kit.getByRole("button", { name: "Continue" }).click();

        await expect(
            page.getByRole("dialog", { name: "Upgrade subscription" }),
        ).toBeVisible();
        await expect.poll(() => checkoutTier).toBe("premiumYearly");
        expect(registrations).toBe(firstRegistrationFails ? 2 : 1);
        expect(recoveryGenerations).toBe(1);
        expect(unexpected).toEqual([]);
    });
}
