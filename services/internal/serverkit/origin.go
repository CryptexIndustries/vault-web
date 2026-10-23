// Package serverkit holds helpers shared by the share server and the agent
// relay.
package serverkit

import (
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

// NormalizeOrigin turns a URL such as "https://Vault.example.com:443/app/"
// into the origin a browser reports ("https://vault.example.com"). The backend
// signs that form into share tickets and relay passes, which servers compare
// exactly; agent relay clients also sign it into their Auth. Hosts that a
// browser would rewrite in ways this function doesn't (internationalized
// names, non-canonical IP addresses or ports) are refused, so a mismatch
// fails at startup instead of rejecting every ticket.
func NormalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return "", fmt.Errorf("%q is not an http(s) URL", raw)
	}
	host := strings.ToLower(u.Hostname())
	for _, r := range host {
		if r > unicode.MaxASCII {
			return "", fmt.Errorf("%q has a non-ASCII host; use its xn-- form", raw)
		}
	}
	if ip, err := netip.ParseAddr(host); err == nil && ip.String() != host {
		return "", fmt.Errorf("%q has a non-canonical IP address; use %s", raw, ip)
	} else if err != nil && strings.Trim(host, "0123456789.") == "" {
		return "", fmt.Errorf("%q has an IPv4 address a browser would rewrite", raw)
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	port := u.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
			return "", fmt.Errorf("%q has an invalid port", raw)
		}
	}
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host += ":" + port
	}
	return u.Scheme + "://" + host, nil
}
