/**
 * The web dashboard as the approver for cryptex-agent, against the real Go
 * relay (token mode) and cryptex-agent built from services/ on this machine:
 * pair by pasting the code, check the confirmation code, approve an Ed25519
 * git signature and an RSA file signature (verified with ssh-keygen -Y
 * verify), deny one, log in through a local sshd, show forwarded and
 * destination-unknown requests, edit keys, see the agent from a restored
 * copy of the vault (approved elsewhere), warn about a renamed server, show
 * the waiting count, pause the agent, move the unlocked vault to another tab
 * with "Use here", and remove an agent the relay no longer knows.
 *
 * Needs go, ssh-keygen, ssh-add and script on the host, so it skips in the
 * Compose runner. Screenshots for review go to CRYPTEX_E2E_SCREENSHOTS.
 */
import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
    fakeHostKey,
    rawLoginRequest,
    startHarness,
    startSSHD,
} from "../agent-harness";
import {
    createVault,
    finishVaultSetup,
    hasTool,
    openSSHKeyEditor,
    pickFile,
} from "../vault-helpers";

const tools = ["go", "ssh-keygen", "ssh-add", "script"];
const missing = tools.filter((tool) => !hasTool(tool));
test.skip(missing.length > 0, `needs ${missing.join(", ")} on the host`);

const services = path.resolve(process.cwd(), "services");
const shotsDir = process.env.CRYPTEX_E2E_SCREENSHOTS ?? "";
const vaultSecret = "agent-e2e-correct-horse-battery-staple-42!";

test.use({ viewport: { width: 1360, height: 860 } });

async function shot(page: Page, name: string) {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    // Let dialogs finish animating in.
    await page.waitForTimeout(350);
    await page.screenshot({
        path: path.join(shotsDir, `${name}.png`),
        // Leftover toasts and the dev server's badge aren't part of the screen.
        style: "[data-sonner-toaster], nextjs-portal { display: none !important; }",
    });
}

/** Generates a key, or imports `keyPath` when given. */
async function addKey(page: Page, name: string, keyPath?: string) {
    const drawer = await openSSHKeyEditor(page);
    if (keyPath) {
        await drawer
            .getByRole("radio", { name: /Use an existing key/ })
            .check();
        await pickFile(page, drawer, "Choose file", keyPath);
    }
    await expect(drawer.getByTestId("ssh-key-fingerprint")).toHaveText(
        /^SHA256:/,
    );
    await drawer.getByLabel(/^Name/).fill(name);
    await drawer.getByRole("button", { name: "Create SSH key" }).click();
    await expect(
        page.getByRole("button", { name: `Actions for ${name}`, exact: true }),
    ).toBeVisible();
}

const requestDialog = (page: Page) => page.getByTestId("agent-request");

test("approves cryptex-agent requests from the dashboard", async ({
    page,
    browser,
}) => {
    test.setTimeout(10 * 60_000);
    const h = await startHarness(services);
    try {
        const agentBin = path.join(h.bin, "cryptex-agent");
        const signEnv = { ...h.agentEnv, SSH_AUTH_SOCK: h.socket };
        const rsaKeyPath = path.join(h.work, "deploy_rsa");
        spawnSync("ssh-keygen", [
            ..."-q -t rsa -b 3072 -C rsa@e2e -f".split(" "),
            rsaKeyPath,
            "-N",
            "",
        ]);
        const listKeys = () =>
            spawnSync("ssh-add", ["-L"], { env: signEnv, encoding: "utf8" })
                .stdout;

        // The approver's log lines from the page, shown when a step fails.
        const pageLog: string[] = [];
        page.on("console", (message) => {
            if (message.text().includes("Agent")) pageLog.push(message.text());
        });
        const waitForRequest = async (target: Page, title: string) => {
            const dialog = requestDialog(target);
            try {
                await expect(dialog).toBeVisible({ timeout: 30_000 });
            } catch (error) {
                const output = [...h.children]
                    .map((child) => child.output)
                    .join("\n---\n");
                console.log(
                    `Page log:\n${pageLog.join("\n")}\nAgent and relay output:\n${output}`,
                );
                throw error;
            }
            await expect(dialog.getByRole("heading")).toHaveText(title);
            return dialog;
        };

        await createVault(page, "Agent vault", vaultSecret);
        await addKey(page, "GitHub");
        await addKey(page, "Deploy", rsaKeyPath);
        await shot(page, "01-sidebar-no-agents");

        // -- Pair ---------------------------------------------------------
        // `pair` waits for Enter on a terminal; `script` gives it one.
        const pair = h.start(
            "script",
            [
                "-q",
                "-f",
                "-e",
                "-c",
                `${agentBin} pair --relay ${h.relayUrl}`,
                "/dev/null",
            ],
            h.agentEnv,
        );
        const [code] = await pair.waitFor(/cryptex-pair:[A-Za-z0-9_-]+/);

        await page.getByTestId("agent-connect").click();
        const connect = page.getByTestId("agent-connect-dialog");
        await expect(connect).toBeVisible();
        await connect.getByTestId("agent-paste").fill(code!);
        await shot(page, "02-connect-paste-code");
        await connect.getByTestId("agent-paste-submit").click();

        // The code names a relay this browser has no token for yet.
        await expect(connect.getByTestId("agent-relay-token")).toBeVisible();
        await connect.getByTestId("agent-relay-token").fill(h.token);
        await shot(page, "03-connect-relay-token");
        await connect.getByTestId("agent-relay-continue").click();

        await expect(connect.getByTestId("agent-offer-machine")).toBeVisible();
        await pair.waitFor(/Code received/i);
        await connect.getByTestId("agent-name").fill("build-box");
        const keyRows = connect.locator('[data-testid^="agent-key-"]');
        await expect(keyRows).toHaveCount(2);
        await keyRows.nth(0).click();
        await keyRows.nth(1).click();
        await expect(connect.getByText("2 of 2")).toBeVisible();
        await shot(page, "04-connect-offer");
        await connect.getByTestId("agent-submit").click();

        const shown = await pair.waitFor(
            /Check that it shows:\s*([0-9A-Z]{4}-[0-9A-Z]{4})/,
        );
        await expect(connect.getByTestId("agent-code")).toHaveText(shown[1]!);
        await shot(page, "05-connect-confirmation-code");
        pair.proc.stdin!.write("\r");
        await pair.waitFor(/Paired with/);
        await expect(
            page.getByText("Connected", { exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId("agent-view")).toBeVisible();
        await expect(page.getByTestId("agent-approver")).toContainText(
            "(this browser)",
        );

        // -- Run the agent ------------------------------------------------
        const service = h.start(agentBin, ["run"], h.agentEnv);
        await expect
            .poll(() => existsSync(h.socket), { timeout: 15_000 })
            .toBe(true);
        await service.waitFor(/Connected to the relay/i);
        const listed = listKeys();
        const edLine = listed
            .split("\n")
            .find((line) => line.startsWith("ssh-ed25519"));
        const rsaLine = listed
            .split("\n")
            .find((line) => line.startsWith("ssh-rsa"));
        expect(edLine, listed).toBeTruthy();
        expect(rsaLine, listed).toBeTruthy();
        const edPub = path.join(h.work, "ed.pub");
        const rsaPub = path.join(h.work, "rsa.pub");
        writeFileSync(edPub, `${edLine}\n`);
        writeFileSync(rsaPub, `${rsaLine}\n`);
        const allowed = path.join(h.work, "allowed_signers");
        writeFileSync(
            allowed,
            [edLine, rsaLine]
                .map(
                    (line) =>
                        `e2e@cryptex ${line!.split(" ").slice(0, 2).join(" ")}`,
                )
                .join("\n") + "\n",
        );

        const sign = (name: string, pub: string, namespace: string) => {
            const file = path.join(h.work, `${name}.txt`);
            writeFileSync(file, `Signed by the web approver E2E (${name}).\n`);
            const child = h.start(
                "ssh-keygen",
                ["-Y", "sign", "-n", namespace, "-f", pub, file],
                signEnv,
            );
            return { file, done: child.exit };
        };
        const expectVerified = (file: string, namespace: string) => {
            const verified = spawnSync(
                "ssh-keygen",
                [
                    ..."-Y verify -I e2e@cryptex -f".split(" "),
                    allowed,
                    "-n",
                    namespace,
                    "-s",
                    `${file}.sig`,
                ],
                { input: readFileSync(file), encoding: "utf8" },
            );
            expect(verified.stdout + verified.stderr).toContain("Good");
            expect(verified.status).toBe(0);
        };

        // -- Approve an Ed25519 git signature ------------------------------
        const git = sign("git-commit", edPub, "git");
        let dialog = await waitForRequest(page, "Sign a git commit?");
        await expect(page).toHaveTitle("(1) Cryptex Vault");
        await expect(
            dialog.getByTestId("agent-remember-process"),
        ).toBeVisible();
        await expect(dialog.getByTestId("agent-approve")).toBeEnabled();
        await shot(page, "06-approval-git-signature");
        await dialog.getByTestId("agent-approve").click();
        expect(await git.done).toBe(0);
        expectVerified(git.file, "git");
        await expect(requestDialog(page)).toHaveCount(0);
        await expect(page).toHaveTitle("Cryptex Vault");

        // -- Approve an RSA file signature (WebCrypto RSASSA-PKCS1-v1_5) ---
        const rsa = sign("rsa-file", rsaPub, "file");
        dialog = await waitForRequest(page, "Sign a file?");
        await expect(dialog).toContainText("Deploy, RSA 3072");
        await dialog.getByTestId("agent-approve").click();
        expect(await rsa.done).toBe(0);
        expectVerified(rsa.file, "file");

        // -- Deny one -------------------------------------------------------
        const denied = sign("denied", edPub, "file");
        dialog = await waitForRequest(page, "Sign a file?");
        await dialog.getByTestId("agent-deny").click();
        expect(await denied.done).not.toBe(0);
        expect(existsSync(`${denied.file}.sig`)).toBe(false);

        // -- Log in through a local sshd ------------------------------------
        const sshd = await startSSHD(h, [edLine!, rsaLine!]);
        if (sshd) {
            const login = sshd.login("echo logged-in");
            dialog = await waitForRequest(
                page,
                `Sign in to 127.0.0.1:${sshd.port}?`,
            );
            // The badge is on the host key, which is what was verified.
            await expect(
                dialog.getByTestId("agent-request-host-key"),
            ).toBeVisible();
            await expect(
                dialog.getByText("verified", { exact: true }),
            ).toBeVisible();
            await expect(dialog).toContainText(
                "Name reported by the machine, not verified",
            );
            await expect(dialog).toContainText(sshd.user);
            await expect(dialog.getByTestId("agent-approve")).toBeEnabled();
            await shot(page, "07-approval-verified-login");
            await dialog.getByTestId("agent-remember-host").click();
            await dialog.getByTestId("agent-approve").click();
            const first = await login;
            expect(first.output).toContain("logged-in");
            expect(first.code).toBe(0);
            // Remembered for this host until the vault locks: no prompt.
            const again = await sshd.login("echo again");
            expect(again.output).toContain("again");
            expect(again.code).toBe(0);
            await expect(requestDialog(page)).toHaveCount(0);
        } else {
            console.warn("sshd isn't installed; skipped the login");
        }

        // -- Forwarded through a jump host, then no session-bind at all -----
        const edBlob = Buffer.from(edLine!.split(" ")[1]!, "base64");
        const jump = fakeHostKey();
        const dest = fakeHostKey();
        writeFileSync(
            h.knownHosts,
            `jump.example.test ${jump.line}\ndest.example.test ${dest.line}\n`,
            { flag: "a" },
        );
        const forwarded = rawLoginRequest(h.socket, edBlob, [
            { host: jump, forwarding: true },
            { host: dest, forwarding: false },
        ]);
        dialog = await waitForRequest(page, "Sign in to dest.example.test?");
        await expect(dialog).toContainText(
            "agent forwarding on jump.example.test",
        );
        await expect(dialog.getByTestId("agent-remember-once")).toHaveCount(0);
        await shot(page, "08-approval-forwarded");
        await dialog.getByTestId("agent-deny").click();
        expect(await forwarded).toBe(false);

        const unknown = rawLoginRequest(h.socket, edBlob, []);
        dialog = await waitForRequest(page, "SSH login, destination unknown");
        // Deny is the default button here.
        await expect(dialog.getByTestId("agent-deny")).toBeFocused();
        await expect(dialog.getByTestId("agent-approve")).toHaveText(
            "Approve once",
        );
        await shot(page, "09-approval-destination-unknown");
        await page.keyboard.press("Enter");
        expect(await unknown).toBe(false);

        // -- A known host key under a new name --------------------------------
        const renamedHost = fakeHostKey();
        const loginToRenamedHost = () =>
            rawLoginRequest(h.socket, edBlob, [
                { host: renamedHost, forwarding: false },
            ]);
        writeFileSync(
            h.knownHosts,
            `prod-db.example.test ${renamedHost.line}\n`,
            { flag: "a" },
        );
        let named = loginToRenamedHost();
        dialog = await waitForRequest(page, "Sign in to prod-db.example.test?");
        await expect(dialog.getByTestId("agent-host-warning")).toHaveCount(0);
        await dialog.getByTestId("agent-approve").click();
        expect(await named).toBe(true);
        writeFileSync(
            h.knownHosts,
            readFileSync(h.knownHosts, "utf8").replace(
                "prod-db.example.test",
                "github.example.test",
            ),
        );
        named = loginToRenamedHost();
        dialog = await waitForRequest(page, "Sign in to github.example.test?");
        await expect(dialog.getByTestId("agent-host-warning")).toHaveText(
            "This machine now calls this server github.example.test. Before, it was prod-db.example.test.",
        );
        await expect(dialog.getByTestId("agent-approve")).toBeEnabled();
        await shot(page, "18-approval-name-changed");
        await dialog.getByTestId("agent-deny").click();
        expect(await named).toBe(false);

        // -- Several waiting: "1 of 2" ----------------------------------------
        const queued1 = sign("queued-1", edPub, "file");
        const queued2 = sign("queued-2", edPub, "file");
        dialog = await waitForRequest(page, "Sign a file?");
        await expect(dialog.getByTestId("agent-request-count")).toHaveText(
            "1 of 2 waiting",
        );
        await expect(dialog.getByTestId("agent-approve")).toBeEnabled();
        await shot(page, "19-approval-queue");
        await dialog.getByTestId("agent-deny").click();
        await expect(dialog.getByTestId("agent-request-count")).toHaveCount(0);
        await dialog.getByTestId("agent-deny").click();
        expect(await queued1.done).not.toBe(0);
        expect(await queued2.done).not.toBe(0);

        // -- Agent page, history, edit keys ----------------------------------
        await page
            .getByTestId(/^agent-row-/)
            .first()
            .click();
        const view = page.getByTestId("agent-view");
        await expect(view.getByTestId("agent-history")).toContainText("Denied");
        await view.getByRole("button", { name: "See all" }).click();
        // The list draws only the rows in view, so scroll through it.
        const scroller = view.locator("[data-radix-scroll-area-viewport]");
        let historyText = "";
        for (let step = 0; step < 30; step++) {
            historyText += await view.getByTestId("agent-history").innerText();
            const atEnd = await scroller.evaluate((el) => {
                el.scrollBy(0, el.clientHeight / 2);
                return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
            });
            await page.waitForTimeout(100);
            if (atEnd) {
                historyText += await view
                    .getByTestId("agent-history")
                    .innerText();
                break;
            }
        }
        expect(historyText).toContain("Approved automatically");
        expect(historyText).toContain("Git signature");
        await scroller.evaluate((el) => el.scrollTo(0, 0));
        await shot(page, "10-sidebar-and-agent-page");

        await view.getByTestId("agent-edit-keys").click();
        const editKeys = page.getByRole("dialog", { name: "Edit keys" });
        await expect(editKeys.getByText("2 of 2")).toBeVisible();
        await shot(page, "11-edit-keys");
        await editKeys.locator('[data-testid^="agent-key-"]').nth(1).click();
        await expect(editKeys.getByText("1 of 2")).toBeVisible();
        await editKeys.getByTestId("agent-keys-save").click();
        await expect(page.getByText("Keys updated")).toBeVisible();
        await expect
            .poll(
                () =>
                    listKeys()
                        .split("\n")
                        .filter((line) => line.startsWith("ssh-")).length,
                { timeout: 20_000 },
            )
            .toBe(1);

        // -- Pause: refused without asking, then resume ----------------------
        await view.getByTestId("agent-menu").click();
        await page.getByTestId("agent-pause-page").click();
        await expect(view.getByTestId("agent-paused")).toBeVisible();
        await view.getByTestId("agent-paused").scrollIntoViewIfNeeded();
        await shot(page, "20-agent-paused");
        const whilePaused = sign("paused", edPub, "file");
        expect(await whilePaused.done).not.toBe(0);
        await expect(requestDialog(page)).toHaveCount(0);
        await view.getByTestId("agent-resume").click();
        await expect(view.getByTestId("agent-paused")).toHaveCount(0);

        // -- Relay settings ---------------------------------------------------
        await page.getByTestId("agent-relay-settings").click();
        const relays = page.getByTestId("agent-relays");
        await expect(
            relays.getByText("127.0.0.1", { exact: false }).first(),
        ).toBeVisible();
        await shot(page, "12-relay-settings");
        await relays.getByTestId(/^agent-relay-127\.0\.0\.1/).click();
        await expect(relays.getByTestId("agent-relay-url")).toHaveValue(
            h.relayUrl,
        );
        await shot(page, "13-relay-settings-edit");
        await page.keyboard.press("Escape");
        await expect(relays).toHaveCount(0);

        // -- Mobile layout ----------------------------------------------------
        await page.setViewportSize({ width: 390, height: 844 });
        await shot(page, "14-mobile-agent-page");
        await page.getByRole("button", { name: "Open device menu" }).click();
        await expect(
            page.getByRole("dialog").getByText("Connected Agents"),
        ).toBeVisible();
        await shot(page, "15-mobile-sidebar");
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1360, height: 860 });

        // -- A copy of the vault restored elsewhere: approved by another device
        await page
            .getByRole("button", { name: /^Backups/ })
            .first()
            .click();
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download backup" }).click();
        const backupPath = path.join(h.work, "vault.cryx");
        await (await download).saveAs(backupPath);
        await page.keyboard.press("Escape");

        const other = await browser.newContext({
            viewport: { width: 1360, height: 860 },
        });
        try {
            const second = await other.newPage();
            await second.goto("/app");
            await second.getByRole("tab", { name: /Restore/ }).click();
            await second
                .locator("#restore-backup-file")
                .setInputFiles(backupPath);
            await second
                .getByPlaceholder("Enter a name for the restored vault")
                .fill("Restored vault");
            await second.getByRole("button", { name: /Restore Vault/ }).click();
            await expect(
                second.getByRole("button", { name: "Unlock Vault" }),
            ).toBeVisible({ timeout: 30_000 });
            await second
                .getByPlaceholder("Enter your secret key")
                .fill(vaultSecret);
            await second.getByRole("button", { name: "Unlock Vault" }).click();
            await finishVaultSetup(second);
            const row = second.getByTestId(/^agent-row-/).first();
            await expect(row).toContainText("Approver: ");
            await row.click();
            await expect(
                second.getByTestId("agent-approver"),
            ).not.toContainText("this browser");
            await expect(second.getByTestId("agent-edit-keys")).toHaveCount(0);
            await shot(second, "16-agent-approved-by-another-device");
        } finally {
            await other.close();
        }

        // -- One unlocked tab: "Use here" locks the other tab first --------
        const tab2 = await page.context().newPage();
        await tab2.goto("/app");
        await expect(tab2.getByTestId("vault-open-elsewhere")).toBeVisible();
        await shot(tab2, "21-open-in-another-tab");
        await tab2.getByTestId("vault-use-here").click();
        await expect(
            page.getByRole("button", { name: "Unlock Vault" }),
        ).toBeVisible();
        await tab2.getByPlaceholder("Enter your secret key").fill(vaultSecret);
        await tab2.getByRole("button", { name: "Unlock Vault" }).click();
        await finishVaultSetup(tab2);
        await expect(page.getByTestId("vault-open-elsewhere")).toBeVisible();
        await expect(tab2.getByTestId(/^agent-row-/)).toHaveCount(1);
        const handedOver = sign("handed-over", edPub, "file");
        dialog = await waitForRequest(tab2, "Sign a file?");
        await dialog.getByTestId("agent-approve").click();
        expect(await handedOver.done).toBe(0);

        // -- The relay forgets the agent: a local state, never a deletion -----
        await tab2
            .getByTestId(/^agent-row-/)
            .first()
            .click();
        const unpaired = spawnSync(agentBin, ["unpair"], {
            env: h.agentEnv,
            encoding: "utf8",
        });
        expect(unpaired.status, unpaired.stdout + unpaired.stderr).toBe(0);
        await expect(tab2.getByTestId("agent-relay-forgot")).toBeVisible({
            timeout: 20_000,
        });
        // Still in the vault until the user removes it.
        await expect(tab2.getByTestId(/^agent-row-/)).toHaveCount(1);
        await shot(tab2, "22-relay-forgot-agent");

        // -- Remove it (the normal revoke) --------------------------------------
        await tab2.getByTestId("agent-menu").click();
        await tab2.getByTestId("agent-revoke").click();
        await expect(tab2.getByRole("alertdialog")).toBeVisible();
        await shot(tab2, "17-revoke-confirmation");
        await tab2.getByTestId("agent-revoke-confirm").click();
        await expect(tab2.getByText("Agent revoked")).toBeVisible();
        await expect(tab2.getByTestId(/^agent-row-/)).toHaveCount(0);
    } finally {
        await h.stop();
    }
});
