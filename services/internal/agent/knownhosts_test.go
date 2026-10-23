package agent

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func hostKeyLine(t *testing.T) (blob []byte, line string) {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	k, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return k.Marshal(), strings.TrimSpace(string(ssh.MarshalAuthorizedKey(k)))
}

// hashed writes a host the way ssh does with HashKnownHosts yes.
func hashed(host string) string {
	salt := make([]byte, sha1.Size)
	rand.Read(salt)
	mac := hmac.New(sha1.New, salt)
	mac.Write([]byte(host))
	return "|1|" + base64.StdEncoding.EncodeToString(salt) + "|" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func TestLabelBindsFromKnownHosts(t *testing.T) {
	github, githubLine := hostKeyLine(t)
	nas, nasLine := hostKeyLine(t)
	jump, jumpLine := hostKeyLine(t)
	unknown, _ := hostKeyLine(t)
	other, otherLine := hostKeyLine(t)

	dir := t.TempDir()
	user := filepath.Join(dir, "known_hosts")
	system := filepath.Join(dir, "ssh_known_hosts")
	os.WriteFile(user, []byte(strings.Join([]string{
		"# comment",
		"github.com,140.82.121.4 " + githubLine,
		hashed("nas.lan") + " " + nasLine,
		hashed("[jump.example.com]:2222") + " " + jumpLine,
		"*.internal " + otherLine,
		"@revoked * " + otherLine,
		"broken line",
	}, "\n")), 0o600)
	os.WriteFile(system, []byte("[git.example.com]:2222 "+githubLine+"\n"), 0o600)

	chain := []*agentpb.Process{
		{Exe: "/usr/bin/ssh", Args: []string{"ssh", "-o", "ForwardAgent=yes", "-p", "2222", "-A", "admin@jump.example.com", "ssh", "nas.lan"}},
		{Exe: "/usr/bin/zsh", Args: []string{"-zsh"}},
	}
	binds := []*agentpb.SessionBind{
		{HostKey: jump, Forwarding: true},
		{HostKey: github},
		{HostKey: nas},
		{HostKey: unknown},
		{HostKey: other},
	}
	got := labelBinds(binds, chain, []string{user, system, filepath.Join(dir, "missing")})
	want := [][]string{
		{"jump.example.com:2222"},
		{"github.com", "140.82.121.4", "git.example.com:2222"},
		// Hashed, and the ssh command line names a different host: no label.
		nil,
		nil,
		// Only a wildcard pattern matches this key.
		nil,
	}
	for i := range binds {
		if !reflect.DeepEqual(got[i].HostNames, want[i]) {
			t.Errorf("bind %d: names %q, want %q", i, got[i].HostNames, want[i])
		}
	}
	if binds[1].HostNames != nil {
		t.Error("labelBinds changed its input")
	}

	// The hop's own ssh names nas.lan, so the hashed entry matches there.
	hop := []*agentpb.Process{{Exe: "/usr/bin/ssh", Args: []string{"ssh", "nas.lan"}}}
	if got := labelBinds([]*agentpb.SessionBind{{HostKey: nas}}, hop, []string{user}); !reflect.DeepEqual(got[0].HostNames, []string{"nas.lan"}) {
		t.Errorf("hashed entry: %q", got[0].HostNames)
	}
}

func TestSSHDestinations(t *testing.T) {
	for _, c := range []struct {
		args []string
		want []string
	}{
		{[]string{"ssh", "github.com"}, []string{"github.com"}},
		{[]string{"ssh", "-i", "id", "-l", "me", "host.example"}, []string{"host.example"}},
		{[]string{"ssh", "-p2222", "git@host.example", "uptime"}, []string{"[host.example]:2222"}},
		{[]string{"ssh", "-p", "22", "host.example"}, []string{"host.example"}},
		{[]string{"ssh", "-o", "SendEnv=GIT_PROTOCOL", "git@github.com", "git-upload-pack", "'repo'"}, []string{"github.com"}},
		{[]string{"ssh", "ssh://deploy@build.example:2200/"}, []string{"[build.example]:2200"}},
		{[]string{"ssh", "-v", "--", "-weird-host"}, []string{"-weird-host"}},
		{[]string{"ssh", "-T"}, nil},
	} {
		got := sshDestinations([]*agentpb.Process{{Exe: "/usr/bin/ssh", Args: c.args}})
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: %q, want %q", c.args, got, c.want)
		}
	}
	if got := sshDestinations([]*agentpb.Process{{Exe: "/usr/bin/git", Args: []string{"git", "push"}}}); got != nil {
		t.Errorf("non-ssh process: %q", got)
	}
}
