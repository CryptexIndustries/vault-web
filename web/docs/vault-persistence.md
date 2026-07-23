# Vault mutation persistence

## Invariants

Every persisted write to an unlocked vault must satisfy these rules:

1. Enter `VaultWriteCoordinator` with an explicit `VaultWriteKind`.
2. Read the current vault only after the write reaches the head of the queue.
3. Produce a fresh vault object; do not mutate the published Jotai snapshot.
4. Encrypt and persist the complete next vault.
5. Publish the next vault only after persistence succeeds.
6. Run lock through the same queue so it is a barrier after pending writes.

The web adapter is `persistVaultMutation` in
`web/src/utils/vault-mutations.ts`. The extension service worker uses the same
coordinator around its IndexedDB/session-storage mutation handlers.

## Adding a mutation

- Add a narrowly named value to `VaultWriteKind`.
- Build the mutation from the `currentVault` supplied by
  `persistVaultMutation`; never from a React render snapshot.
- Do not call `VaultMetadata.save` directly from unlocked-vault UI code.
- Return failure to the initiating UI. Dialogs must remain open until durable
  success is confirmed.
- Add a test for persistence failure and, when relevant, overlap with another
  mutation.
- Never log mutation payloads or credential values. The write kind is the safe
  audit identifier.

## Why the web host is not a worker

The coordinator is an actor-like boundary but is intentionally independent of
its execution realm. A dedicated worker would move encryption work off the main
thread, but it would not itself solve ordering across multiple tabs because
each tab creates its own worker. It would also add an RPC protocol and vault
hydration boundary before measurements show that persistence blocks the UI.

The browser extension retains its existing Manifest V3 service worker as the
privileged host. The regular web application hosts the coordinator in-process.
The shared core can move behind a dedicated-worker transport later without
changing mutation semantics.

The current queue serializes one JavaScript realm. If simultaneous editing from
multiple web tabs becomes supported, we're going to add an exclusive Web Lock
keyed by vault ID and either reload/rebase the latest encrypted vault after
acquiring it or enforce a single active writer tab. A Web Lock alone is
insufficient when the waiting tab still holds a stale vault snapshot.
