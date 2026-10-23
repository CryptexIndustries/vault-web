package serverkit

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Env reads a trimmed environment variable, or fallback when it is empty.
func Env(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

// EnvOrFile reads NAME, or the file named by NAME_FILE (Docker secrets).
func EnvOrFile(name string) (string, error) {
	if path := Env(name+"_FILE", ""); path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("%s_FILE: %w", name, err)
		}
		return strings.TrimSpace(string(raw)), nil
	}
	return Env(name, ""), nil
}

// EnvInt reads a positive integer, or fallback when the variable is empty.
func EnvInt(name string, fallback int) (int, error) {
	raw := Env(name, "")
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return v, nil
}
