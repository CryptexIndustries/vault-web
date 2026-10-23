// Command cryptex-agent is an SSH agent for Linux that holds no private
// keys. ssh, git and ssh-keygen talk to it as to any agent; it forwards each
// signature request through the agent relay to the Cryptex Vault device it
// was paired with, where the user approves it.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"golang.org/x/sys/unix"

	"github.com/CryptexIndustries/vault-web/services/internal/agent"
	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
)

// version is set at build time with -ldflags "-X main.version=0.1.0".
var version = "dev"

const usage = `cryptex-agent - SSH agent that keeps your private keys in Cryptex Vault

cryptex-agent holds no private keys. It sends each signature request through a
relay to the Cryptex Vault device you paired it with (the Android app or the
web app), where you approve it.

Usage:
  cryptex-agent <command> [flags]

Commands:
  pair      Pair this machine with Cryptex Vault
  run       Serve the agent socket (the systemd user service runs this)
  status    Show the pairing, the keys and whether the service runs
  unpair    Remove this agent from the relay and forget the pairing
  version   Print the version
  help      Show this help

Pair flags:
` + pairFlags + `
Files:
  ~/.config/cryptex-agent/config        Settings: relay, notify, terminal
                                        (optional; not created for you)
  ~/.local/share/cryptex-agent/         Identity and pairing (state.json) and
                                        the key last used per server; keep it
                                        private
  $XDG_RUNTIME_DIR/cryptex-agent.sock   The agent socket

Environment:
  Point ssh and git at the agent socket:
    bash, zsh:  export SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/cryptex-agent.sock
    fish:       set -gx SSH_AUTH_SOCK $XDG_RUNTIME_DIR/cryptex-agent.sock

Run 'cryptex-agent pair --help' for pairing details.
`

const pairFlags = `      --relay URL   Relay to pair through, written exactly as the relay's own
                    address (localhost and 127.0.0.1 differ). https://, or
                    http:// for localhost, 127.0.0.1 or [::1] only.
                    (default: relay in the config file, or
                    ` + agent.DefaultRelayURL + `)
      --force       Replace the current pairing once the new one succeeds
      --invert      Draw the QR code for a light terminal background
`

const pairUsage = `Pair this machine with Cryptex Vault. Scan the QR code or paste the code in
the Android app or the web app, choose the keys, and check that both sides show
the same confirmation code.

Usage:
  cryptex-agent pair [flags]

Flags:
` + pairFlags + `  -h, --help        Show this help
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	paths, err := agent.DefaultPaths(os.Getenv)
	if err != nil {
		fmt.Fprintln(stderr, "cryptex-agent:", err)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cmd, rest := args[0], args[1:]
	switch cmd {
	case "pair":
		err = pair(ctx, paths, rest, stdin, stdout, stderr)
	case "run":
		err = serve(ctx, paths, rest, stdout, stderr)
	case "status":
		err = noArgs(cmd, rest, stdout, stderr)
		if err == nil {
			err = agent.PrintStatus(paths, stdout)
		}
	case "unpair":
		err = noArgs(cmd, rest, stdout, stderr)
		if err == nil {
			err = agent.Unpair(ctx, agent.UnpairOptions{Paths: paths, Out: stdout, Version: version})
		}
	case "version", "--version", "-v":
		fmt.Fprintln(stdout, "cryptex-agent", version)
	case "help", "--help", "-h":
		fmt.Fprint(stdout, usage)
	default:
		fmt.Fprintf(stderr, "cryptex-agent: unknown command %q\n\n%s", cmd, usage)
		return 2
	}
	var usageErr usageError
	switch {
	case err == nil, errors.Is(err, errHelpShown):
		return 0
	case errors.As(err, &usageErr):
		return 2
	case errors.Is(err, agent.ErrPairingCancelled):
		// pair said so already.
		return 1
	case ctx.Err() != nil:
		// Ctrl-C during pair: the user knows; no error text.
		return 130
	default:
		// Errors can quote the relay or the approver.
		fmt.Fprintln(stderr, "cryptex-agent:", termsafe.String(err.Error(), maxErrorLength))
		return 1
	}
}

// maxErrorLength caps a printed error, which may wrap a few relay or
// approver strings that are capped on their own.
const maxErrorLength = 600

// usageError means the flag package already printed the problem.
type usageError struct{ error }

func noArgs(cmd string, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {}
	if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) {
		fmt.Fprint(stdout, usage)
		return errHelpShown
	} else if err != nil {
		return usageError{err}
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "cryptex-agent %s takes no arguments\n", cmd)
		return usageError{errors.New("arguments")}
	}
	return nil
}

// errHelpShown ends a command whose --help was printed.
var errHelpShown = errors.New("help shown")

func pair(ctx context.Context, paths agent.Paths, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("pair", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {}
	relay := fs.String("relay", "", "")
	force := fs.Bool("force", false, "")
	invert := fs.Bool("invert", false, "")
	if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) {
		fmt.Fprint(stdout, pairUsage)
		return nil
	} else if err != nil {
		fmt.Fprintln(stderr, "Run 'cryptex-agent pair --help' for the flags.")
		return usageError{err}
	}
	if fs.NArg() > 0 {
		fmt.Fprintln(stderr, "cryptex-agent pair takes no arguments besides flags")
		return usageError{errors.New("arguments")}
	}
	_, err := agent.Pair(ctx, agent.PairOptions{
		Paths:       paths,
		RelayURL:    *relay,
		Force:       *force,
		Invert:      *invert,
		Version:     version,
		Out:         stdout,
		Interactive: isTerminal(os.Stdin) && isTerminal(os.Stdout),
		In:          stdin,
	})
	return err
}

func serve(ctx context.Context, paths agent.Paths, args []string, stdout, stderr io.Writer) error {
	if err := noArgs("run", args, stdout, stderr); err != nil {
		return err
	}
	opts := &slog.HandlerOptions{}
	if os.Getenv("JOURNAL_STREAM") != "" {
		// journald stamps every line already.
		opts.ReplaceAttr = func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) == 0 && a.Key == slog.TimeKey {
				return slog.Attr{}
			}
			return a
		}
	}
	logger := slog.New(slog.NewTextHandler(stderr, opts))
	// x/crypto/ssh/agent reports every refused request through the
	// standard logger in a terse form; the agent logs its own outcomes.
	log.SetOutput(io.Discard)
	return agent.Run(ctx, agent.Options{Paths: paths, Logger: logger, Version: version})
}

func isTerminal(f *os.File) bool {
	_, err := unix.IoctlGetTermios(int(f.Fd()), unix.TCGETS)
	return err == nil
}
