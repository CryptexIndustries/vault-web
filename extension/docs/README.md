# Extension Documentation

Security and design notes for the Cryptex Vault browser extension.

## Start here

- [Threat model](threat-model.md) — Trust boundaries, assets, attackers, controls,
  residual risks, and hardening roadmap.
- [Architecture overview](architecture/overview.md) — Realms, storage split, three
  parallel stacks (envelope bus, OS JWT, Pusher/WebRTC).

## Service worker

- [Service worker index](service-worker/README.md)
- [Messaging and capability model](service-worker/messaging.md) — Envelope protocol,
  origin validation, per-origin ACLs, ProxyFetch rules.
- [Session and keys](service-worker/session-and-keys.md) — Unlock/lock, DEK, ECDH
  rotation, Online Services session.

## UI surfaces

- [Extension UI](ui/README.md) - Popup, full-page vault dashboard, and link tab; privilege
  tiers and sensitive operations.

## Sync and link

- [Sync and link](sync-and-link/README.md) — WebRTC sync, device linking, vault
  bridge through SW.
- [Online Services](sync-and-link/online-services.md) — JWT lifecycle and tRPC
  proxy chain.

## Platform

- [Platform layer](platform/README.md) — Manifest, WAR, idle lock, logging summary.
- [Persistence](platform/persistence.md) — IndexedDB, session, local storage catalog.
- [Content scripts](platform/content-scripts.md) — Injection model, field detection,
  save-on-submit.
- [Build and release](platform/build-and-release.md) — Dual Vite build, prod manifest
  rewrite, shipping checklist.

## Autofill

- [Autofill security notes](autofill/README.md) — Iframe bootstrap and URL rule
  matching policy.
- [Iframe bootstrap](autofill/iframe-bootstrap.md)
- [Origin matching](autofill/origin-matching.md)

## Passkeys

- [Passkey architecture](passkeys/README.md) — WebAuthn interception, software
  authenticator encoding, user-verification policy, and reference designs.

## Reading order for security review

1. [Threat model](threat-model.md)
2. [Architecture overview](architecture/overview.md)
3. [Service worker messaging](service-worker/messaging.md)
4. [Autofill security notes](autofill/README.md)
5. [Passkey architecture](passkeys/README.md)
6. [UI surfaces](ui/README.md)
7. [Sync and link](sync-and-link/README.md)
8. [Platform layer](platform/README.md)
