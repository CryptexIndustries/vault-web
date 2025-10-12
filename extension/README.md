## Cryptex Vault Extension (MVP)

- Action popup contains Unlock and Link flows reused from `web/`.
- Background holds unlocked vault state and initializes sync controller.

Dev:

```
pnpm i
pnpm --filter extension dev
```

Load unpacked in Chrome:
- Build: `pnpm --filter extension build`
- Load folder `extension/` in chrome://extensions
