# Share server changelog

Each `share-server-vX.Y.Z` release and the Share server tab of the changelog page show that version's section.

## 1.0.1 - 2026-10-22

### Added

- `share-server version` prints the version, and the startup log includes it.

### Changed

- Built with Go 1.26.10.

### Fixed

- Sweep counters start at zero, so an alert sees the first failed sweep.

## 1.0.0 - 2026-10-14

### Added

- First release of the server behind one-time share links. It stores only ciphertext and token hashes.
