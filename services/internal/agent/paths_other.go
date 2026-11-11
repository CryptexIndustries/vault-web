//go:build !darwin

package agent

const (
	// ShellSocket is the value to give SSH_AUTH_SOCK in a shell profile.
	ShellSocket = "$XDG_RUNTIME_DIR/" + SocketName
	// StartCommand starts the service now and at every login.
	StartCommand = "systemctl --user enable --now cryptex-agent"
)
