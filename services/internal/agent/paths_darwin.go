package agent

const (
	// ShellSocket is the value to give SSH_AUTH_SOCK in a shell profile.
	ShellSocket = "$HOME/.local/share/cryptex-agent/" + SocketName
	// StartCommand starts the service now and at every login.
	StartCommand = "brew services start cryptex-agent"
)
