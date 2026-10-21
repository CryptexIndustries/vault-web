package serverkit

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ClientIP returns the address rate limits apply to. header names a header
// set by a trusted proxy (for example "X-Forwarded-For" or
// "CF-Connecting-IP"); empty uses the socket address. hops is how many
// proxies append to it: the client address is that many entries from the
// right, and anything further left was written by the client.
//
// IPv6 addresses are reduced to their /64 network ("2001:db8:1:2::/64"),
// because one subscriber usually gets at least a /64 and could otherwise
// mint a fresh rate-limit bucket per address. IPv4 addresses stay whole.
func ClientIP(r *http.Request, header string, hops int) string {
	if header != "" {
		var entries []string
		for _, value := range r.Header.Values(header) {
			entries = append(entries, strings.Split(value, ",")...)
		}
		hops = max(hops, 1)
		if len(entries) >= hops {
			// Only a real address counts; anything else falls back to the
			// socket so junk values can't mint new rate-limit buckets.
			entry := strings.TrimSpace(entries[len(entries)-hops])
			if addr, err := netip.ParseAddr(entry); err == nil {
				return rateLimitKey(addr)
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return rateLimitKey(addr)
	}
	return host
}

func rateLimitKey(addr netip.Addr) string {
	// Unmap first so an IPv4-mapped address counts as the IPv4 one. The
	// zone goes too: it names a local interface, not a client.
	addr = addr.Unmap().WithZone("")
	if addr.Is4() {
		return addr.String()
	}
	prefix, _ := addr.Prefix(64)
	return prefix.String()
}

// NetworkKey widens a ClientIP key to the network around it: a /48 for IPv6,
// which sites and many ISPs hand out whole, and a /24 for IPv4. A cap per
// network keeps one holder of many addresses from taking a shared resource
// that a per-address cap alone would let them fill. Keys that aren't
// addresses come back unchanged.
func NetworkKey(clientKey string) string {
	addr, err := netip.ParseAddr(clientKey)
	if err != nil {
		prefix, err := netip.ParsePrefix(clientKey)
		if err != nil {
			return clientKey
		}
		addr = prefix.Addr()
	}
	addr = addr.Unmap().WithZone("")
	bits := 48
	if addr.Is4() {
		bits = 24
	}
	prefix, _ := addr.Prefix(bits)
	return prefix.String()
}
