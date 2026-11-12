package agent

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
)

// desktopNotifier returns a notifier that runs the platform's notification
// command, or nil when that command isn't installed.
func desktopNotifier(log *slog.Logger) func(approverName string) {
	name, args := "notify-send", notifyArgs
	if runtime.GOOS == "darwin" {
		name, args = "osascript", osascriptArgs
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return nil
	}
	return func(approverName string) {
		// launchd starts the macOS service in the login session.
		if runtime.GOOS != "darwin" && !desktopSession(os.Getenv) {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, path, args(approverName)...)
		if err := cmd.Run(); err != nil {
			log.Debug("desktop notification failed", "command", name, "error", err)
		}
	}
}

// notifyArgs are notify-send's arguments. Notification daemons read the
// body as markup, so the approver's name is escaped as well as sanitized.
func notifyArgs(approverName string) []string {
	body := "Approve the SSH request in Cryptex Vault on " + markupEscaper.Replace(termsafe.Name(approverName))
	// "--" so a body starting with "-" isn't taken for an option.
	return []string{"--app-name=Cryptex Agent", "--icon=dialog-password", "--", "SSH request waiting", body}
}

// osascriptArgs are osascript's arguments. The text goes in as script
// arguments, never into the script's source, so a name can't add AppleScript.
// The fixed title comes first: osascript stops reading options there, so a
// body starting with "-" isn't taken for one.
func osascriptArgs(approverName string) []string {
	return []string{
		"-e", "on run argv",
		"-e", "display notification (item 2 of argv) with title (item 1 of argv)",
		"-e", "end run",
		"SSH request waiting",
		"Approve the SSH request in Cryptex Vault on " + termsafe.Name(approverName),
	}
}

var markupEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

// desktopSession guesses whether a notification would be seen. A systemd
// user service often lacks DISPLAY, but the session bus is enough for
// notify-send.
func desktopSession(getenv func(string) string) bool {
	if getenv("WAYLAND_DISPLAY") != "" || getenv("DISPLAY") != "" || getenv("DBUS_SESSION_BUS_ADDRESS") != "" {
		return true
	}
	if rt := getenv("XDG_RUNTIME_DIR"); rt != "" {
		if _, err := os.Stat(filepath.Join(rt, "bus")); err == nil {
			return true
		}
	}
	return false
}
