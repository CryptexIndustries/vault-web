package agent

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// DefaultRelayURL is the hosted relay.
const DefaultRelayURL = "https://relay.cryptex-vault.com"

// Config is the optional settings file: `key = value` lines, # comments.
type Config struct {
	// Relay is the default for `pair --relay`.
	Relay string
	// Notify enables desktop notifications for waiting requests.
	Notify bool
	// Terminal prints a line to the requesting terminal while a request
	// waits.
	Terminal bool
}

// LoadConfig reads the settings file; a missing file means defaults.
func LoadConfig(path string) (Config, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return ParseConfig(strings.NewReader(""))
	}
	if err != nil {
		return Config{}, err
	}
	defer f.Close()
	cfg, err := ParseConfig(f)
	if err != nil {
		return cfg, fmt.Errorf("%s: %w", path, err)
	}
	return cfg, nil
}

// ParseConfig parses settings. Unknown keys are errors so a typo doesn't
// silently do nothing.
func ParseConfig(r io.Reader) (Config, error) {
	cfg := Config{Relay: DefaultRelayURL, Notify: true}
	scanner := bufio.NewScanner(r)
	for n := 1; scanner.Scan(); n++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key, value = strings.TrimSpace(key), strings.Trim(strings.TrimSpace(value), `"`)
		if !ok || key == "" {
			return cfg, fmt.Errorf("line %d: expected key = value", n)
		}
		switch key {
		case "relay":
			if value == "" {
				return cfg, fmt.Errorf("line %d: relay is empty", n)
			}
			if err := relayclient.CheckRelayURL(value); err != nil {
				return cfg, fmt.Errorf("line %d: %w", n, err)
			}
			cfg.Relay = value
		case "notify", "terminal":
			on, ok := parseBool(value)
			if !ok {
				return cfg, fmt.Errorf("line %d: %s must be true or false", n, key)
			}
			if key == "notify" {
				cfg.Notify = on
			} else {
				cfg.Terminal = on
			}
		default:
			return cfg, fmt.Errorf("line %d: unknown setting %q", n, key)
		}
	}
	return cfg, scanner.Err()
}

func parseBool(value string) (on, ok bool) {
	switch strings.ToLower(value) {
	case "true", "yes", "on", "1":
		return true, true
	case "false", "no", "off", "0":
		return false, true
	}
	return false, false
}
