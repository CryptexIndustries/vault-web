package agent

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const (
	maxHostNames    = 4
	maxHostNameSize = 253
	// known_hosts files can be large on busy machines; stop reading early
	// rather than slow down every signature.
	maxKnownHostsBytes = 4 << 20
)

// defaultKnownHostsFiles are the files ssh reads by default.
func defaultKnownHostsFiles() []string {
	files := []string{"/etc/ssh/ssh_known_hosts", "/etc/ssh/ssh_known_hosts2"}
	if home, err := os.UserHomeDir(); err == nil {
		files = append([]string{
			filepath.Join(home, ".ssh", "known_hosts"),
			filepath.Join(home, ".ssh", "known_hosts2"),
		}, files...)
	}
	return files
}

// labelBinds returns copies of binds with HostNames filled from the
// known_hosts files, so the approver can show "github.com" next to the host
// key it verifies. Hashed entries can't be read back, so they are matched
// against the destinations named on the calling ssh command lines.
func labelBinds(binds []*agentpb.SessionBind, chain []*agentpb.Process, files []string) []*agentpb.SessionBind {
	if len(binds) == 0 {
		return binds
	}
	entries := readKnownHosts(files)
	candidates := sshDestinations(chain)
	out := make([]*agentpb.SessionBind, len(binds))
	for i, b := range binds {
		labeled := proto.Clone(b).(*agentpb.SessionBind)
		labeled.HostNames = hostNamesFor(entries, b.GetHostKey(), candidates)
		out[i] = labeled
	}
	return out
}

type knownHost struct {
	patterns []string
	key      []byte
}

func readKnownHosts(files []string) []knownHost {
	var out []knownHost
	for _, path := range files {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(io.LimitReader(f, maxKnownHostsBytes))
		sc.Buffer(make([]byte, 0, 64<<10), 64<<10)
		for sc.Scan() {
			fields := strings.Fields(sc.Text())
			if len(fields) < 3 || strings.HasPrefix(fields[0], "#") || strings.HasPrefix(fields[0], "@") {
				// Comments, and @cert-authority / @revoked lines, which
				// don't name a host's own key.
				continue
			}
			key, err := base64.StdEncoding.DecodeString(fields[2])
			if err != nil {
				continue
			}
			out = append(out, knownHost{patterns: strings.Split(fields[0], ","), key: key})
		}
		f.Close()
	}
	return out
}

func hostNamesFor(entries []knownHost, hostKey []byte, candidates []string) []string {
	var names []string
	add := func(name string) {
		if len(names) >= maxHostNames || len(name) > maxHostNameSize {
			return
		}
		for _, n := range names {
			if n == name {
				return
			}
		}
		names = append(names, name)
	}
	for _, e := range entries {
		if !bytes.Equal(e.key, hostKey) {
			continue
		}
		for _, p := range e.patterns {
			switch {
			case strings.HasPrefix(p, "|1|"):
				for _, c := range candidates {
					if hashedMatch(p, c) {
						add(displayHost(c))
					}
				}
			case strings.ContainsAny(p, "*?!"):
				// A pattern, not a name.
			default:
				add(displayHost(p))
			}
		}
	}
	return names
}

// hashedMatch checks a HashKnownHosts entry ("|1|salt|hash") against a host
// in known_hosts form ("host" or "[host]:port").
func hashedMatch(entry, host string) bool {
	parts := strings.Split(entry, "|")
	if len(parts) != 4 {
		return false
	}
	salt, err1 := base64.StdEncoding.DecodeString(parts[2])
	want, err2 := base64.StdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	mac := hmac.New(sha1.New, salt)
	mac.Write([]byte(host))
	return hmac.Equal(mac.Sum(nil), want)
}

// displayHost turns "[host]:2222" into "host:2222".
func displayHost(h string) string {
	if strings.HasPrefix(h, "[") {
		if end := strings.Index(h, "]"); end > 0 {
			return h[1:end] + h[end+1:]
		}
	}
	return h
}

// sshOptionsWithValue are the ssh options whose next argument is a value,
// not the destination.
const sshOptionsWithValue = "BbcDEeFIiJLlmOoPpQRSWw"

// sshDestinations finds the hosts ssh was asked to connect to, in known_hosts
// form, from the ssh processes in the calling chain. Only used to test hashed
// known_hosts entries, so a wrong guess just finds nothing.
func sshDestinations(chain []*agentpb.Process) []string {
	var out []string
	for _, p := range chain {
		if filepath.Base(p.GetExe()) != "ssh" || len(p.GetArgs()) < 2 {
			continue
		}
		args := p.GetArgs()[1:]
		port := ""
		for i := 0; i < len(args); i++ {
			a := args[i]
			if a == "--" {
				if i+1 < len(args) {
					out = append(out, knownHostsForm(args[i+1], port))
				}
				break
			}
			if strings.HasPrefix(a, "-") && len(a) > 1 {
				opt := a[1:2]
				if strings.Contains(sshOptionsWithValue, opt) {
					value := a[2:]
					if value == "" && i+1 < len(args) {
						i++
						value = args[i]
					}
					if opt == "p" {
						port = value
					}
				}
				continue
			}
			out = append(out, knownHostsForm(a, port))
			break
		}
	}
	return out
}

func knownHostsForm(dest, port string) string {
	rest, isURL := strings.CutPrefix(dest, "ssh://")
	if at := strings.LastIndex(rest, "@"); at >= 0 {
		rest = rest[at+1:]
	}
	if isURL {
		rest = strings.TrimSuffix(rest, "/")
		if h, p, err := net.SplitHostPort(rest); err == nil {
			rest, port = h, p
		}
	}
	dest = rest
	if n, err := strconv.Atoi(port); err == nil && n != 22 {
		return "[" + dest + "]:" + port
	}
	return dest
}
