package agent

import (
	"slices"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func TestNotifyArgs(t *testing.T) {
	args := notifyArgs("<b>Pixel</b> & \x1b]52;c;eA==\x07co")
	body := args[len(args)-1]
	if want := "Approve the SSH request in Cryptex Vault on &lt;b&gt;Pixel&lt;/b&gt; &amp; �]52;c;eA==�co"; body != want {
		t.Fatalf("body %q, want %q", body, want)
	}
	// Options end before the texts.
	if i := slices.Index(args, "--"); i < 0 || i > len(args)-3 {
		t.Fatalf("args %q", args)
	}
}

func TestGrantedKeyCommentsAreSanitized(t *testing.T) {
	_, bind := testSessionBind(t, false)
	parsed, _ := parseSessionBind(bind)
	key := parsed.HostKey
	keys := grantedKeys([]*agentpb.GrantedKey{
		{PublicKey: key, Comment: "deploy\x1b]0;owned\x07 ‮key" + strings.Repeat("x", 200)},
		{PublicKey: []byte("not a key"), Comment: "dropped"},
	})
	if len(keys) != 1 {
		t.Fatalf("%d keys", len(keys))
	}
	if c := keys[0].Comment; strings.ContainsAny(c, "\x1b\x07‮") || len([]rune(c)) > 100 || !strings.HasPrefix(c, "deploy�]0;owned") {
		t.Fatalf("comment %q", c)
	}
	if _, err := ssh.ParsePublicKey(keys[0].PublicKey); err != nil {
		t.Fatal(err)
	}
}

func TestClockWarning(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	for _, c := range []struct {
		server time.Time
		want   string
	}{
		{now, ""},
		{now.Add(30 * time.Second), ""},
		{now.Add(-29 * time.Second), ""},
		{now.Add(31 * time.Second), "Your clock is off by about 31 s; requests may be refused"},
		{now.Add(-10 * time.Minute), "Your clock is off by about 600 s; requests may be refused"},
	} {
		msg, off := clockWarning(&agentpb.Challenge{ServerTime: c.server.UnixMilli()}, now)
		if msg != c.want || off != (c.want != "") {
			t.Errorf("server at %v: %q", c.server.Sub(now), msg)
		}
	}
	// A relay that sends no time says nothing about our clock.
	if _, off := clockWarning(&agentpb.Challenge{}, now); off {
		t.Error("warned without a server time")
	}
}
