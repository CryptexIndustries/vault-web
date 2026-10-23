package relayclient

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

// Relay endpoints, below the relay URL's path.
const (
	ConnectPath = "/v1/connect"
	PairPath    = "/v1/pair"
	RevokePath  = "/v1/revoke"
)

// Origin is what clients sign into Auth: the relay URL as a browser origin.
func Origin(relayURL string) (string, error) {
	return serverkit.NormalizeOrigin(relayURL)
}

// WebSocketURL maps an http(s) relay URL to the ws(s) URL of path, keeping a
// base path such as "https://example.com/relay".
func WebSocketURL(relayURL, path string) (string, error) {
	u, err := endpoint(relayURL, path)
	if err != nil {
		return "", err
	}
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	return u.String(), nil
}

// HTTPURL is the plain URL of an HTTP endpoint such as RevokePath.
func HTTPURL(relayURL, path string) (string, error) {
	u, err := endpoint(relayURL, path)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// CheckRelayURL refuses a relay URL the agent mustn't connect to: anything
// but https, except http on this machine for development. Elsewhere the
// relay access token would cross the network in clear, and approvers
// refuse such relays anyway.
func CheckRelayURL(relayURL string) error {
	_, err := endpoint(relayURL, "")
	return err
}

// checkScheme is the rule the approvers apply too.
func checkScheme(u *url.URL) error {
	switch {
	case u.Scheme == "https":
		return nil
	case u.Scheme != "http":
		return errors.New("must start with https://")
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return nil
	}
	return errors.New("must use https://; http:// is only for a relay on this machine (localhost, 127.0.0.1 or [::1])")
}

// endpoint appends path to an http(s) relay URL, dropping any query.
func endpoint(relayURL, path string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(relayURL))
	if err != nil {
		return nil, fmt.Errorf("relay URL: %w", err)
	}
	if err := checkScheme(u); err != nil {
		return nil, fmt.Errorf("relay URL %q %w", relayURL, err)
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + path
	u.RawQuery, u.Fragment, u.RawPath = "", "", ""
	return u, nil
}
