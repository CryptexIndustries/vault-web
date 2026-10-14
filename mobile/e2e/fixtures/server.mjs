import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fixtureTotpAccepted } from "./totp-verifier.mjs";
import { frameFieldStates, frameValuesResult } from "./frame-verifier.mjs";

const port = Number(process.env.CRYPTEX_E2E_FIXTURE_PORT ?? 43110);
let freshNavigationId = 0;

const page = (title, body, script = "") => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title></head><body><main><h1>${title}</h1>${body}</main>
<script>${script}</script></body></html>`;

const escapeHtml = (value) =>
    String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

const readForm = async (request) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const loginPage = page(
    "Deterministic login fixture",
    `<form method="post" action="/login?submitted=1">
      <label>Username <input name="username" autocomplete="username"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password"></label>
      <button>Sign in</button>
    </form><p id="login-state">Login fields empty</p>`,
    `
const inputs = [...document.querySelectorAll('input')];
setInterval(() => {
  const filled = inputs.filter(input => input.value.length > 0).length;
  document.querySelector('#login-state').textContent = 'Login fields '
    + (filled === 0 ? 'empty' : filled === 2 ? 'filled' : 'partially filled');
}, 200);`,
);

const autoLockWaitPage = page(
    "Background auto-lock fixture",
    `<p id="wait-state">Waiting for the one-minute auto-lock interval</p>`,
    `setTimeout(() => {
      document.querySelector('#wait-state').textContent = 'Auto-lock interval elapsed';
      const url = new URL(location.href);
      url.searchParams.set('elapsed', '1');
      history.replaceState(null, '', url);
    }, 65000);`,
);

const frameOriginPage = page(
    "Frame origin fixture",
    `<p>The visible framed form uses a different host from the page and off-screen frame. Use test logins only.</p>
     <form><label>Page username <input name="username" autocomplete="username"></label>
     <label>Page password <input name="password" type="password" autocomplete="current-password"></label></form>
     <p><span id="page-state">Page empty</span> · <span id="frame-state">Visible frame loading</span> · <span id="offscreen-state">Off-screen frame loading</span></p>
     <button id="frame-check" type="button" style="position:fixed;top:8px;right:8px;z-index:1;padding:12px">Check frame state</button>
     <iframe title="Different-site login form" src="http://127.0.0.1:${port}/frame-login?context=visible" width="380" height="180"></iframe>
     <iframe title="Off-screen login form" src="http://localhost:${port}/frame-login?context=offscreen" style="position:absolute;left:-10000px;width:1px;height:1px"></iframe>
     <p id="frame-exact-state">Exact frame values loading</p>`,
    `
${frameFieldStates.toString()}
${frameValuesResult.toString()}
const exactFrames = {};
const reportExact = () => {
  document.querySelector('#frame-exact-state').textContent = 'Exact frame values ' + frameValuesResult(exactFrames);
};
const formState = (form, label) => {
  const filled = [...form.querySelectorAll('input')].filter(input => input.value.length > 0).length;
  return label + ' ' + (filled === 0 ? 'empty' : filled === 2 ? 'filled' : 'partially filled');
};
const pageForm = document.querySelector('form');
setInterval(() => {
  document.querySelector('#page-state').textContent = formState(pageForm, 'Page');
  exactFrames.page = frameFieldStates(pageForm.elements.username.value, pageForm.elements.password.value);
  reportExact();
}, 200);
window.addEventListener('message', event => {
  if (event.data?.context === 'visible' && event.origin !== 'http://127.0.0.1:${port}') return;
  if (event.data?.context === 'offscreen' && event.origin !== 'http://localhost:${port}') return;
  const id = event.data?.context === 'visible' ? 'frame-state'
    : event.data?.context === 'offscreen' ? 'offscreen-state' : null;
  if (!id || !['empty', 'filled', 'partially filled'].includes(event.data.state)) return;
  const label = id === 'frame-state' ? 'Visible frame' : 'Off-screen frame';
  document.querySelector('#' + id).textContent = label + ' ' + event.data.state;
  exactFrames[event.data.context] = event.data.values;
  reportExact();
});
document.querySelector('#frame-check').addEventListener('click', () => {
  const state = id => document.querySelector('#' + id).textContent.split(' ').at(-1);
  const params = new URLSearchParams({
    case: new URLSearchParams(location.search).get('case') ?? 'default',
    page: state('page-state'),
    visible: state('frame-state'),
    offscreen: state('offscreen-state'),
  });
  location.href = '/frame-check?' + params;
});`,
);

const frameLoginPage = page(
    "Different-site login form",
    `<form><label>Frame username <input name="username" autocomplete="username"></label>
     <label>Frame password <input name="password" type="password" autocomplete="current-password"></label></form>`,
    `
${frameFieldStates.toString()}
const context = new URLSearchParams(location.search).get('context');
const inputs = [...document.querySelectorAll('input')];
const report = () => {
  const filled = inputs.filter(input => input.value.length > 0).length;
  const state = filled === 0 ? 'empty' : filled === 2 ? 'filled' : 'partially filled';
  parent.postMessage({ context, state, values: frameFieldStates(inputs[0].value, inputs[1].value) }, 'http://localhost:${port}');
};
inputs.forEach(input => {
  input.addEventListener('input', report);
  input.addEventListener('change', report);
});
setInterval(report, 200);
report();`,
);

const registrationPage = page(
    "Deterministic registration fixture",
    `<form method="post" action="/register?submitted=1">
      <label>Email address <input name="email" type="email" autocomplete="email"></label>
      <label>New username <input name="username" autocomplete="username"></label>
      <label>New password <input name="password" type="password" autocomplete="new-password"></label>
      <label>Confirm password <input name="password-confirmation" type="password" autocomplete="new-password"></label>
      <button>Create account</button>
    </form>`,
);

const passwordUpdatePage = page(
    "Deterministic password update fixture",
    `<form method="post" action="/change-password">
      <label>Username <input name="username" autocomplete="username"></label>
      <label>New password <input name="password" type="password" autocomplete="new-password"></label>
      <label>Confirm new password <input name="password-confirmation" type="password" autocomplete="new-password"></label>
      <button>Change password</button>
    </form>`,
);

const passkeyPage = page(
    "Deterministic passkey fixture",
    `<p id="status" role="status" aria-live="assertive" tabindex="-1">Ready</p>
     <button id="create-a">Create account A</button>
     <button id="create-b">Create account B</button>
     <button id="get-a">Use account A</button>
     <button id="get-any">Use any passkey</button>
     <button id="duplicate-a">Try duplicate account A</button>
     <button id="create-cancel">Start cancellable create</button>`,
    `
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const status = document.querySelector('#status');
const report = value => { status.textContent = value; status.focus(); };
const accounts = {
  a: { id: 'Zml4dHVyZS11c2VyLWE', name: 'fixture-a@example.test', displayName: 'Fixture User A' },
  b: { id: 'Zml4dHVyZS11c2VyLWI', name: 'fixture-b@example.test', displayName: 'Fixture User B' },
  cancel: { id: 'Zml4dHVyZS11c2VyLWNhbmNlbA', name: 'cancel@example.test', displayName: 'Cancel Fixture' }
};
const storedId = account => localStorage.getItem('credential-' + account);
const verification = import('/passkey-verifier.mjs');
const create = async (account, duplicate = false) => {
  try {
    const user = accounts[account];
    const existing = duplicate ? storedId(account) : null;
    const challenge = new TextEncoder().encode('cryptex-passkey-create-' + account);
    const credential = await navigator.credentials.create({ publicKey: {
      challenge,
      rp: { id: location.hostname, name: 'Cryptex E2E' },
      user: { id: decode(user.id), name: user.name, displayName: user.displayName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: existing ? [{ type: 'public-key', id: decode(existing) }] : [],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60000,
      attestation: 'none'
    }});
    const registration = await (await verification).verifyRegistration(credential, {
      challenge, rpId: location.hostname, origin: location.origin, userHandle: user.id
    });
    localStorage.setItem('registration-' + account, JSON.stringify(registration));
    localStorage.setItem('credential-' + account, encode(credential.rawId));
    report('Passkey ' + account.toUpperCase() + ' created');
  } catch (error) {
    report(duplicate
      ? 'Duplicate rejected: ' + error.name
      : account === 'cancel'
        ? 'Create cancelled: ' + error.name
        : 'Create failed: ' + error.name + ': ' + error.message);
  }
};
const get = async account => {
  try {
    const id = account ? storedId(account) : null;
    const challenge = decode('Y3J5cHRleC1kZXRlcm1pbmlzdGljLWdldA');
    const credential = await navigator.credentials.get({ publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: id ? [{ type: 'public-key', id: decode(id) }] : [],
      userVerification: 'required', timeout: 60000
    }});
    const handle = encode(credential.response.userHandle);
    const selected = Object.entries(accounts).find(([, user]) => user.id === handle)?.[0] ?? 'unknown';
    if (selected === 'unknown' || (account && selected !== account)) throw new Error('Unexpected account');
    const registration = JSON.parse(localStorage.getItem('registration-' + selected));
    if (!registration) throw new Error('Missing registration');
    const verified = await (await verification).verifyAssertion(credential, registration, {
      challenge, rpId: location.hostname, origin: location.origin
    });
    localStorage.setItem('registration-' + selected, JSON.stringify(verified));
    report('Authenticated account ' + selected.toUpperCase());
  } catch (error) { report('Authentication failed: ' + error.name + ': ' + error.message); }
};
document.querySelector('#create-a').onclick = () => create('a');
document.querySelector('#create-b').onclick = () => create('b');
document.querySelector('#get-a').onclick = () => get('a');
document.querySelector('#get-any').onclick = () => get(null);
document.querySelector('#duplicate-a').onclick = () => create('a', true);
document.querySelector('#create-cancel').onclick = () => create('cancel');`,
);

const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/passkey-verifier.mjs") {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(readFileSync(new URL("./passkey-verifier.mjs", import.meta.url)));
        return;
    }
    const freshPage = {
        "/fresh-login": "/login",
        "/fresh-frame-origin": "/frame-origin",
        "/fresh-register": "/register",
        "/fresh-auto-lock-wait": "/auto-lock-wait",
    }[url.pathname];
    if (freshPage) {
        response.statusCode = 302;
        response.setHeader("cache-control", "no-store");
        response.setHeader(
            "location",
            `${freshPage}?case=${encodeURIComponent(url.searchParams.get("case") ?? "default")}&fresh=${Date.now()}-${++freshNavigationId}`,
        );
        response.end();
        return;
    }
    if (url.pathname === "/health") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
    }
    if (url.pathname === "/auto-lock-wait") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(autoLockWaitPage);
        return;
    }
    if (url.pathname === "/login") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "text/html; charset=utf-8");
        if (request.method === "POST") {
            const form = await readForm(request);
            const empty = !form.get("username") && !form.get("password");
            const accepted =
                form.get("username") === "fixture@example.test" &&
                form.get("password") === "fixture-password";
            response.statusCode = 303;
            response.setHeader(
                "location",
                `/login/otp?accepted=${accepted ? "1" : "0"}&empty=${empty ? "1" : "0"}`,
            );
            response.end();
        } else {
            response.end(loginPage);
        }
        return;
    }
    if (url.pathname === "/frame-origin") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(frameOriginPage);
        return;
    }
    if (url.pathname === "/frame-login") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(frameLoginPage);
        return;
    }
    if (url.pathname === "/frame-check") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(page("Frame state checked", "<p>Fixture state recorded in the URL</p>"));
        return;
    }
    if (url.pathname === "/login/otp") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
            url.searchParams.get("accepted") === "1"
                ? page(
                      "Verification required",
                      `<p>Signed in as fixture@example.test</p>
                       <form method="post" action="/otp">
                         <label>Verification code <input name="otp" inputmode="numeric" autocomplete="one-time-code"></label>
                         <button>Verify</button>
                       </form>`,
                  )
                : page("Sign-in rejected", "<p>Credentials were not filled correctly</p>"),
        );
        return;
    }
    if (url.pathname === "/register") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "text/html; charset=utf-8");
        if (request.method === "POST") {
            const form = await readForm(request);
            const accepted =
                form.get("email") === "earlier-browser-email@example.test" &&
                form.get("username") === "browser-new@example.test" &&
                form.get("password") === "browser-new-password" &&
                form.get("password-confirmation") === "browser-new-password";
            response.statusCode = 303;
            response.setHeader("location", `/register?accepted=${accepted ? "1" : "0"}`);
            response.end();
        } else {
            response.end(
                url.searchParams.get("accepted") === "1"
                    ? page("Registration complete", "<p>Created browser-new@example.test</p>")
                    : registrationPage,
            );
        }
        return;
    }
    if (url.pathname === "/change-password") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        if (request.method === "POST") {
            const form = await readForm(request);
            response.end(
                page(
                    "Password changed",
                    `<p>Updated ${escapeHtml(form.get("username") ?? "")}</p>`,
                ),
            );
        } else {
            response.end(passwordUpdatePage);
        }
        return;
    }
    if (url.pathname === "/otp" && request.method === "POST") {
        const form = await readForm(request);
        const code = form.get("otp") ?? "";
        response.statusCode = 303;
        response.setHeader("location", `/otp?accepted=${fixtureTotpAccepted(code) ? "1" : "0"}`);
        response.end();
        return;
    }
    if (url.pathname === "/otp") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
            page(
                "Verification complete",
                url.searchParams.get("accepted") === "1"
                    ? "<p>Accepted the fixture authenticator code</p>"
                    : "<p>Rejected invalid code</p>",
            ),
        );
        return;
    }
    if (url.pathname === "/passkeys") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(passkeyPage);
        return;
    }
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "fixture route not found" }));
});

server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Cryptex E2E fixture listening on ${port}\n`);
});
