# Security analysis worker

`security-analysis.ts` bundles the shared vault-core analyzer and zxcvbn into a
self-contained program. `security-analysis-worker.ts` evaluates and runs it on a
React Native Worklets worker runtime, never the RN or UI runtime. Progress is
limited to ten updates per second. Cancellation is checked between credentials;
callbacks from an obsolete run are ignored. Only the required credential fields
cross into the worker, and results contain no passwords.

Metro regenerates `security-analysis.generated.json` at startup. After changing
the shared analyzer or its dependencies, restart Metro or run:

```sh
node scripts/build-security-worker.cjs
```

Keep the generated JSON alongside the source so type checks and tests also work
without starting Metro. The build rejects any remaining external imports. URL
and text-encoding polyfills are included because isolated Hermes runtimes don't
inherit React Native's browser globals. Unused crypto and domain-matching imports
are eliminated; the actual analysis and scoring rules remain shared with web.

`security-analysis-worker.test.ts` compares the bundled program in an isolated
Node worker against the shared analyzer on 320 credentials. This checks bundle
isolation and result parity, not Android frame timing. The cancellation tests
cover late callbacks and scans cancelled while queued.
