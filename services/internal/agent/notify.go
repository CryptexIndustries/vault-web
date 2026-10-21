package agent

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
)

// desktopNotifier returns a notify-send based notifier, or nil when
// notify-send isn't installed.
func desktopNotifier(log *slog.Logger) func(approverName string) {
	path, err := exec.LookPath("notify-send")
	if err != nil {
		return nil
	}
	return func(approverName string) {
		if !desktopSession(os.Getenv) {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, path, notifyArgs(approverName)...)
		if err := cmd.Run(); err != nil {
			log.Debug("notify-send failed", "error", err)
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
