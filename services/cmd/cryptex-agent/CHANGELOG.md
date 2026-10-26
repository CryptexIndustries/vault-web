# cryptex-agent changelog

Each `cryptex-agent-vX.Y.Z` release lists the bullets of its section here.

## 0.1.2 - 2026-10-26

- Cancelling a pairing or running `cryptex-agent unpair` no longer sometimes warns that the agent couldn't be removed from the relay when it already was.

## 0.1.1 - 2026-10-22

- First release. The agent holds no private keys: it sends each signing request to the Cryptex Vault device it was paired with, and only the signature comes back.
- Pairs with a QR code in the terminal and runs as a systemd user service.
