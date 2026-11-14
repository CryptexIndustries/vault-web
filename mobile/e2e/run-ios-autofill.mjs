// The iOS AutoFill extension suite. Maestro prepares the vault, and a native
// XCUITest drives Settings, Safari and the extension, which Maestro can't
// reach. This script serves the login pages and answers Face ID prompts.
import { execFileSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    watch,
    writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureTotpAccepted } from "./fixtures/totp-verifier.mjs";
import { flow, resultsDirectory, test, xcode } from "./ios-simulator.mjs";

const serial = process.env.MAESTRO_DEVICE;
const port = Number(process.env.CRYPTEX_E2E_IOS_AUTOFILL_PORT ?? 43120);
const site = `http://localhost:${port}`;
// The same pages over HTTPS, where the extension offers to associate a website.
const secureSite = `https://localhost:${port + 1}`;

const page = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
// The page reports what AutoFill entered, since XCUITest reads password
// fields only as dots.
const credentialForm = (title, passwordType) =>
    page(
        title,
        `<form method="get" action="/signed-in">
<label>Username <input name="username" autocomplete="username"></label>
<label>Password <input name="password" type="password" autocomplete="${passwordType}"></label>
<button>Continue</button></form><p id="state">Empty</p><script>
setInterval(() => {
  const [username, password] = document.querySelectorAll("input");
  document.querySelector("#state").textContent =
    "Filled: " + (username.value || "nothing") + " / " + (password.value || "nothing");
}, 200);
</script>`,
    );

const pages = {
    "/login": credentialForm("Sign in", "current-password"),
    "/signup": credentialForm("Create account", "new-password"),
    "/signed-in": page("Signed in", "<p>Signed in</p>"),
};

const servePage = (request, response) => {
    const url = new URL(request.url, site);
    const body = pages[url.pathname];
    response.writeHead(body ? 200 : 404, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
    });
    response.end(body ?? "Not found");
};
const server = createServer(servePage);

const simctl = (...args) =>
    execFileSync("xcrun", ["simctl", ...args], { stdio: "ignore" });
const faceIdMatch = () =>
    simctl(
        "spawn",
        serial,
        "notifyutil",
        "-p",
        "com.apple.BiometricKit_Sim.pearl.match",
    );

const clipboard = () =>
    execFileSync("xcrun", ["simctl", "pbpaste", serial], { encoding: "utf8" });

// The test asks for things by creating files in this folder. Face ID answers
// only while a "match" file exists, so the test can check what shows before.
// The match repeats, because a post made before the prompt is up is lost.
// "filled" asks for the clipboard right after a fill, since the copied code
// expires after 30 seconds.
const requests = mkdtempSync(join(tmpdir(), "cryptex-ios-autofill-"));

let matching = null;
let copied = null;
const answer = () => {
    const faceIdRequested = existsSync(join(requests, "match"));
    if (faceIdRequested && !matching) matching = setInterval(faceIdMatch, 500);
    if (!faceIdRequested && matching) {
        clearInterval(matching);
        matching = null;
    }
    if (!copied && existsSync(join(requests, "filled")))
        copied = { code: clipboard().trim(), at: Date.now() };
};
const watcher = watch(requests, answer);

// A certificate for localhost that only this Simulator trusts. It lives in
// the temporary folder, so each run makes a new one.
function secureServer() {
    const config = join(requests, "localhost.cnf");
    const key = join(requests, "localhost.key");
    const certificate = join(requests, "localhost.pem");
    writeFileSync(
        config,
        `[req]
distinguished_name = name
x509_extensions = extensions
prompt = no
[name]
CN = localhost
[extensions]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyCertSign
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:127.0.0.1
`,
    );
    execFileSync(
        "openssl",
        [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "30",
            "-keyout",
            key,
            "-out",
            certificate,
            "-config",
            config,
        ],
        { stdio: "ignore" },
    );
    simctl("keychain", serial, "add-root-cert", certificate);
    return createSecureServer(
        { key: readFileSync(key), cert: readFileSync(certificate) },
        servePage,
    );
}

// As in run-biometric-flow.sh: enroll Face ID, which a reboot forgets.
function enrollFaceId() {
    simctl(
        "spawn",
        serial,
        "notifyutil",
        "-s",
        "com.apple.BiometricKit.enrollmentChanged",
        "1",
    );
    simctl(
        "spawn",
        serial,
        "notifyutil",
        "-p",
        "com.apple.BiometricKit.enrollmentChanged",
    );
}

// The bar with the Passwords key needs the full software keyboard. Maestro's
// flows expect none, so this comes after them.
function showSoftwareKeyboard() {
    for (const key of [
        "AutomaticMinimizationEnabled",
        "HardwareKeyboardLastSeen",
    ])
        simctl(
            "spawn",
            serial,
            "defaults",
            "write",
            "com.apple.keyboard.preferences",
            key,
            "-bool",
            "NO",
        );
}

/** Runs a Maestro flow while Face ID matches every prompt. */
async function flowWithFaceId(name) {
    const loop = setInterval(faceIdMatch, 1000);
    try {
        await flow(name, { env: { CRYPTEX_E2E_SITE: site } });
    } finally {
        clearInterval(loop);
    }
}

mkdirSync(resultsDirectory, { recursive: true });
process.env.TEST_RUNNER_CRYPTEX_SITE = site;
process.env.TEST_RUNNER_CRYPTEX_SECURE_SITE = secureSite;
process.env.TEST_RUNNER_CRYPTEX_APP_NAME = process.env.CRYPTEX_APP_NAME;
process.env.TEST_RUNNER_CRYPTEX_REQUESTS = requests;
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const secure = secureServer();
await new Promise((resolve) => secure.listen(port + 1, "127.0.0.1", resolve));
try {
    enrollFaceId();
    await xcode("build-for-testing");
    await flowWithFaceId("ios-autofill-setup.yaml");
    showSoftwareKeyboard();
    const autofillTest = (name) => test(name, "AutofillTests");
    await autofillTest("testTurnOnProvider");
    await autofillTest("testCancelFill");
    await autofillTest("testFillPassword");
    if (!copied || !fixtureTotpAccepted(copied.code, copied.at))
        throw new Error("The fill did not copy the current verification code.");
    await autofillTest("testAssociateWebsite");
    await autofillTest("testAddLogin");
    await autofillTest("testSaveNewLogin");
    await autofillTest("testUpdateLogin");
    await autofillTest("testAppAddsSavedLogins");
} finally {
    watcher.close();
    clearInterval(matching);
    rmSync(requests, { recursive: true, force: true });
    server.close();
    secure.close();
}
