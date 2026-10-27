# cryptex-agent changelog

Each `cryptex-agent-vX.Y.Z` release and the SSH agent tab of the changelog page show that version's section.

## 0.1.2 - 2026-10-26

### Fixed

- Cancelling a pairing or running `cryptex-agent unpair` no longer sometimes warns that the agent couldn't be removed from the relay when it already was.

## 0.1.1 - 2026-10-22

### Added

- First release. The agent holds no private keys: it sends each signing request to the Cryptex Vault device it was paired with, and only the signature comes back.
- Pairs with a QR code in the terminal and runs as a systemd user service.
