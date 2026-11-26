// The deterministic passkey page, served by server.mjs for Android and by
// run-ios-autofill.mjs for iOS. It imports /passkey-verifier.mjs.
const page = (title, body, script) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title></head><body><main><h1>${title}</h1>${body}</main>
<script>${script}</script></body></html>`;

export const passkeyPage = page(
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
