# cryptex-agent

An SSH agent for Linux that holds no private keys. When `ssh`, `git` or
`ssh-keygen` asks it to sign, it sends the request through the agent relay to
the Cryptex Vault app it was paired with. You approve on your phone, the vault
signs, and only the signature comes back.

`ssh-add -L` works offline: the agent keeps the public keys you granted when
pairing.

## Install

From this tarball:

```sh
sudo install -Dm755 cryptex-agent /usr/bin/cryptex-agent
sudo install -Dm644 cryptex-agent.service /usr/lib/systemd/user/cryptex-agent.service
```

To install without root, copy the binary to `~/.local/bin` and the unit to
`~/.config/systemd/user/`, and change the unit's `ExecStart=` to
`%h/.local/bin/cryptex-agent run`.

An AUR package for Arch Linux, `cryptex-agent-bin`, will follow.

## Pair

```sh
cryptex-agent pair
```

In Cryptex Vault on your phone, open Devices > Add > Connect an agent and scan
the QR code, or paste the code printed below it. Pick the SSH keys this
machine may use and give it a name. If the code expires, press Enter for a new
one.

The terminal and the phone then show the same short code, such as
`CP22-34W6`. Press Enter if they match. If they don't, someone else answered
the QR code first: press Ctrl-C, and the agent removes that pairing again.
Nothing is saved until you press Enter.

The QR code is drawn for dark terminal backgrounds. On a light background use
`cryptex-agent pair --invert`.

For a self-hosted relay: `cryptex-agent pair --relay https://relay.example.com`.
Use exactly the address set as the relay's `RELAY_PUBLIC_URL`. Sign-ins are
checked against that address, so `localhost` fails on a relay that calls
itself `127.0.0.1`, even on the same machine. The relay must use `https://`. Plain `http://` works only for a relay on this
machine (`localhost`, `127.0.0.1` or `[::1]`), the same rule Cryptex Vault
applies: anywhere else the access token would cross the network unencrypted.
`pair`, the config file and the service all refuse other `http://` relays.
The agent doesn't follow redirects from a relay, so a relay can't send it to
another server.

## Run

```sh
systemctl --user enable --now cryptex-agent
```

Then point SSH at the agent, for example in `~/.bashrc` or `~/.zshrc`:

```sh
export SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/cryptex-agent.sock
```

Check that it works with `ssh-add -L` and `cryptex-agent status`.

Each signature waits up to 90 seconds for your approval. If it isn't answered
within a few seconds and `notify-send` is installed, a desktop notification
reminds you to look at your phone.

The agent logs each request it waits on and how it ended (`journalctl --user
-u cryptex-agent`). With `terminal = true` in the config file it also prints
"waiting for approval" in the terminal that made the request, once a request
has waited a second.

When you change this agent's keys in Cryptex Vault, the agent saves the new
list in `state.json`. If it can't write the file, it signs nothing, drops the
relay connection and reconnects to fetch the list again.

## Commands

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `cryptex-agent pair`    | Pair with Cryptex Vault. `--force` replaces an existing pairing.    |
| `cryptex-agent run`     | Serve the agent socket; the systemd unit runs this.                 |
| `cryptex-agent status`  | Show the pairing, the granted keys and whether the service answers. |
| `cryptex-agent unpair`  | Remove this agent from the relay and forget the pairing.            |
| `cryptex-agent version` | Print the version.                                                  |

The agent never holds a private key, so `ssh-add` with a key, `ssh-add -d`,
`ssh-add -D` and `ssh-add -x` are refused.

## Files

- `~/.local/share/cryptex-agent/` (or `$XDG_DATA_HOME/cryptex-agent/`): the
  agent's identity and pairing (`state.json`) and the key last used with each
  server (`hosts.json`). Keep this folder private; it is created with mode 0700. Don't publish it with your dotfiles.
- `~/.config/cryptex-agent/config` (optional):

  ```
  # Relay used by `cryptex-agent pair` without --relay.
  relay = https://relay.cryptex-vault.com
  # Desktop notifications while a request waits.
  notify = true
  # A line in the requesting terminal while a request waits.
  terminal = false
  ```

- `$XDG_RUNTIME_DIR/cryptex-agent.sock`: the agent socket, mode 0600. Only
  processes of your own user may use it. The agent refuses to start if
  `$XDG_RUNTIME_DIR` belongs to another user or others can write to it.

## Revoking

Revoke the agent in Cryptex Vault on any of your linked devices, or run
`cryptex-agent unpair` on this machine. A revoked agent lists no keys and
signs nothing until you pair it again.

The relay can't prove a revocation, so the agent keeps the key list on disk
and asks the relay again, first after 15 minutes and then less often, up to
once a day. If the relay takes it back, it serves its keys again. A week
after the relay first called it revoked, or stopped knowing it (as after
losing its data), the agent stops asking until you pair it again.

## What the phone sees

With each request the agent sends the calling process and its parents (pid,
program, arguments, working directory), the machine's hostname, and the
`session-bind@openssh.com` records OpenSSH 8.9 and later send, which name the
server you're logging in to. The phone checks those records itself. Everything
except routing information is end-to-end encrypted between this agent and your
phone; the relay sees only which agent talks to which device, when, and how
much.

License: AGPL-3.0-only, see LICENSE.
