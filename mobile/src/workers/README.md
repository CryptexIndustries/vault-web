# Background workers

Each worker is a self-contained program bundled from shared vault-core code and
evaluated on its own React Native Worklets runtime, never the RN or UI runtime.

## Security analysis

`security-analysis.ts` bundles the shared vault-core analyzer and zxcvbn.
`security-analysis-worker.ts` runs it on the `vault-security-analysis` runtime.
Progress is limited to ten updates per second. Cancellation is checked between
credentials; callbacks from an obsolete run are ignored. Only the required
credential fields cross into the worker, and results contain no passwords.

## SSH keys

`ssh-key.ts` bundles vault-core's `runSSHKeyTask`. `ssh-key-worker.ts` runs it
on the `vault-ssh-key` runtime for every key import (paste, file, unlock, .pub
changes) and every private key export (Save private key, and loading the key
in the item details). Parsing RSA and P-521 keys and bcrypt key derivation are
slow on Hermes without a JIT, so none of it runs on the RN runtime. Generating
an Ed25519 key is fast and stays on the RN runtime.

Tasks run one at a time. `createSSHKeyTaskRunner` keeps one job per form or
dialog: a new run or `cancel()` drops the previous result, and a queued task
nobody waits for is skipped. A task that's already running can't be stopped;
its result is ignored. A worker that can't start or load gives an "internal"
error, never a hang.

The worker runtime has no `crypto.getRandomValues`. Imports don't need random
bytes. For exports the RN side sends secure random bytes in the task's
`random`, and an encrypted export without them fails instead of using a weaker
source.

## Building

Metro regenerates the `*.generated.json` programs at startup. After changing the
shared code or its dependencies, restart Metro or run:

```sh
node scripts/build-workers.cjs
```

The generated JSON isn't tracked. `pnpm mobile:check` builds it before the type
check and Jest builds it before tests, so neither needs Metro. If your editor
can't resolve the import, run the script once.

The build rejects any remaining external imports. `polyfills.ts` adds text
encoding, `atob` and `btoa` because isolated Hermes runtimes don't inherit React
Native's browser globals; the security worker also gets a URL polyfill. Unused
crypto and domain-matching imports are eliminated from the security worker; the
actual analysis and scoring rules remain shared with web.

## Tests

`security-analysis-worker.test.ts` compares the bundled program in an isolated
Node worker against the shared analyzer on 320 credentials. This checks bundle
isolation and result parity, not Android frame timing. The cancellation tests
cover late callbacks and scans cancelled while queued.

`ssh-key-worker.test.ts` runs the SSH key program the same way, in a context
without crypto, text encoding or base64 globals, and compares imports (including
an encrypted key), an export round trip and error codes with `runSSHKeyTask`.
`ssh-key-worker-client.test.ts` covers random bytes, failures and dropped runs.
