package agent

import (
	"fmt"
	"path/filepath"
)

// SocketName lives in $XDG_RUNTIME_DIR.
const SocketName = "cryptex-agent.sock"

// Paths are where the agent keeps its files. Tests point them at temporary
// directories.
type Paths struct {
	// DataDir holds state.json (identity, approver, granted keys) and
	// hosts.json. Created 0700.
	DataDir string
	// ConfigFile is the optional settings file.
	ConfigFile string
	// Socket is the SSH agent socket. Empty when XDG_RUNTIME_DIR isn't set,
	// which only `run` and `status` care about.
	Socket string
}

// DefaultPaths follows the XDG base directory spec. The identity goes under
// the data directory rather than ~/.config because people publish dotfiles.
func DefaultPaths(getenv func(string) string) (Paths, error) {
	home := getenv("HOME")
	xdg := func(name, fallback string) (string, error) {
		// The spec says relative values are invalid and must be ignored.
		if v := getenv(name); filepath.IsAbs(v) {
			return v, nil
		}
		if home == "" {
			return "", fmt.Errorf("neither %s nor HOME is set", name)
		}
		return filepath.Join(home, fallback), nil
	}
	data, err := xdg("XDG_DATA_HOME", ".local/share")
	if err != nil {
		return Paths{}, err
	}
	config, err := xdg("XDG_CONFIG_HOME", ".config")
	if err != nil {
		return Paths{}, err
	}
	p := Paths{
		DataDir:    filepath.Join(data, "cryptex-agent"),
		ConfigFile: filepath.Join(config, "cryptex-agent", "config"),
	}
	if rt := getenv("XDG_RUNTIME_DIR"); filepath.IsAbs(rt) {
		p.Socket = filepath.Join(rt, SocketName)
	}
	return p, nil
}
