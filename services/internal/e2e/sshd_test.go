package e2e

import (
	"bytes"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	sshagent "golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/approvertest"
)

// sshd is an OpenSSH server run as the current user on a free local port,
// trusting the granted keys. Logins land on the current user's account.
type sshd struct {
	t          *testing.T
	port       string
	user       string
	hostKey    ssh.PublicKey
	knownHosts string
}

func startSSHD(t *testing.T, authorized []ssh.Signer) *sshd {
	t.Helper()
	needTools(t, "ssh", "ssh-keygen", "ssh-keyscan")
	binary := ""
	for _, path := range []string{"/usr/sbin/sshd", "/usr/bin/sshd"} {
		if _, err := os.Stat(path); err == nil {
			binary = path
		}
	}
	if binary == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("sshd is required in CI")
		}
		t.Skip("sshd not installed")
	}
	me, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	hostKeyPath := filepath.Join(dir, "host_ed25519")
	if out, err := exec.Command("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", hostKeyPath).CombinedOutput(); err != nil {
		t.Fatalf("ssh-keygen: %v\n%s", err, out)
	}
	var keys bytes.Buffer
	for _, k := range authorized {
		keys.Write(ssh.MarshalAuthorizedKey(k.PublicKey()))
	}
	authPath := filepath.Join(dir, "authorized_keys")
	if err := os.WriteFile(authPath, keys.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	ln.Close()
	config := strings.Join([]string{
		"Port " + port,
		"ListenAddress 127.0.0.1",
		"HostKey " + hostKeyPath,
		"AuthorizedKeysFile " + authPath,
		"PidFile " + filepath.Join(dir, "sshd.pid"),
		// The temporary folder isn't laid out the way StrictModes expects.
		"StrictModes no",
		"UsePAM no",
		"PasswordAuthentication no",
		"KbdInteractiveAuthentication no",
		"PermitRootLogin prohibit-password",
		"AllowAgentForwarding yes",
		"AllowUsers " + me.Username,
	}, "\n") + "\n"
	configPath := filepath.Join(dir, "sshd_config")
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	// Running as root (CI containers), sshd wants its privilege separation
	// directory.
	if os.Geteuid() == 0 {
		os.MkdirAll("/run/sshd", 0o755)
	}
	cmd := exec.Command(binary, "-D", "-e", "-f", configPath)
	var logs bytes.Buffer
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Wait()
		if t.Failed() {
			t.Logf("sshd log:\n%s", logs.String())
		}
	})

	pub, err := os.ReadFile(hostKeyPath + ".pub")
	if err != nil {
		t.Fatal(err)
	}
	hostKey, _, _, _, err := ssh.ParseAuthorizedKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	knownHosts := filepath.Join(dir, "known_hosts")
	line := "[127.0.0.1]:" + port + " " + string(ssh.MarshalAuthorizedKey(hostKey))
	if err := os.WriteFile(knownHosts, []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &sshd{t: t, port: port, user: me.Username, hostKey: hostKey, knownHosts: knownHosts}
	s.waitReady()
	return s
}

// login runs ssh with only the agent's keys and returns its output.
func (s *sshd) login(p *paired, extra []string, command string) (string, error) {
	args := []string{
		"-F", "none", "-p", s.port,
		"-o", "IdentityAgent=" + p.paths.Socket,
		"-o", "IdentityFile=/dev/null",
		"-o", "UserKnownHostsFile=" + s.knownHosts,
		"-o", "StrictHostKeyChecking=yes",
		"-o", "HostKeyAlgorithms=ssh-ed25519",
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=5",
	}
	args = append(args, extra...)
	args = append(args, s.user+"@127.0.0.1", command)
	out, err := p.tool(nil, "ssh", args...)
	return strings.TrimSpace(string(out)), err
}

func (s *sshd) waitReady() {
	s.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		// A key scan costs no approval; only a login does.
		out, err := exec.Command("ssh-keyscan", "-p", s.port, "-t", "ed25519", "127.0.0.1").Output()
		if err == nil && len(out) > 0 {
			return
		}
		if time.Now().After(deadline) {
			s.t.Fatal("sshd never came up")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestOpenSSHLogins(t *testing.T) {
	p := pair(t, startRelay(t, nil), setup{})
	server := startSSHD(t, p.keys)
	hostBlob := server.hostKey.Marshal()
	// Let the agent read the server's name from the test's known_hosts.
	p.stopAgent()
	p.opts.KnownHostsFiles = []string{server.knownHosts}
	p.startAgent()
	p.waitFor(func() bool { return p.service.Status().Connected }, "agent never reconnected")
	hostName := "127.0.0.1:" + server.port

	for _, tc := range []struct {
		name, algorithms string
		key              int
		flags            uint32
	}{
		{"ed25519", "ssh-ed25519", 0, 0},
		{"ecdsa", "ecdsa-sha2-nistp256", 1, 0},
		{"rsa-sha2-256", "rsa-sha2-256", 2, 2},
		{"rsa-sha2-512", "rsa-sha2-512", 2, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := len(p.approver.Requests())
			out, err := server.login(p, []string{"-o", "PubkeyAcceptedAlgorithms=" + tc.algorithms}, "echo logged-in")
			if err != nil || out != "logged-in" {
				t.Fatalf("ssh: %q %v", out, err)
			}
			reqs := p.approver.Requests()[before:]
			if len(reqs) != 1 {
				t.Fatalf("login made %d requests, want 1", len(reqs))
			}
			r := reqs[0]
			// approvertest matched the login's session and key against the
			// bind.
			if r.Kind != approvertest.KindUserauth || r.Err != nil {
				t.Errorf("approver took the login as %s (%v)", r.Kind, r.Err)
			}
			if !bytes.Equal(r.Sign.PublicKey, p.keys[tc.key].PublicKey().Marshal()) {
				t.Errorf("signed with %s, want key %d", r.Key.Type(), tc.key)
			}
			if r.Sign.Flags != tc.flags {
				t.Errorf("sign flags %d, want %d", r.Sign.Flags, tc.flags)
			}
			binds := r.Sign.SessionBinds
			// approvertest refuses requests whose session-bind signature
			// doesn't verify, so a login means it verified.
			if len(binds) != 1 || !bytes.Equal(binds[0].HostKey, hostBlob) || binds[0].Forwarding {
				t.Errorf("session binds %+v, want one for the server's host key", binds)
			} else if len(binds[0].HostNames) != 1 || binds[0].HostNames[0] != hostName {
				t.Errorf("host names %q, want %q from known_hosts", binds[0].HostNames, hostName)
			}
			if exe := filepath.Base(r.Sign.Processes[0].Exe); exe != "ssh" {
				t.Errorf("caller %q, want ssh", exe)
			}
		})
	}

	// The last login used the RSA key, so the agent now offers it first to
	// this server: an unrestricted login asks for the RSA key only.
	t.Run("last used key first", func(t *testing.T) {
		before := len(p.approver.Requests())
		if out, err := server.login(p, nil, "echo logged-in"); err != nil || out != "logged-in" {
			t.Fatalf("ssh: %q %v", out, err)
		}
		reqs := p.approver.Requests()[before:]
		if len(reqs) != 1 || !bytes.Equal(reqs[0].Sign.PublicKey, p.keys[2].PublicKey().Marshal()) {
			t.Fatalf("requests %d, first key %v; want the RSA key only", len(reqs), reqs[0].Key.Type())
		}
	})

	// ssh -A to the server, then a second hop from there back into the same
	// server through the forwarded agent.
	t.Run("forwarded hop", func(t *testing.T) {
		before := len(p.approver.Requests())
		hop := "ssh -F none -p " + server.port + " -o IdentityFile=/dev/null -o UserKnownHostsFile=" + server.knownHosts +
			" -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 -o BatchMode=yes " + server.user + "@127.0.0.1 echo second-hop"
		out, err := server.login(p, []string{"-A"}, hop)
		if err != nil || !strings.HasSuffix(out, "second-hop") {
			t.Fatalf("ssh -A: %q %v", out, err)
		}
		reqs := p.approver.Requests()[before:]
		if len(reqs) != 2 {
			t.Fatalf("forwarded login made %d requests, want 2", len(reqs))
		}
		// Both are logins the approver could tie to a bind: the second
		// hop's own bind comes last and isn't marked forwarding.
		for i, r := range reqs {
			if r.Kind != approvertest.KindUserauth || r.Decision != approvertest.Approve || r.Err != nil {
				t.Errorf("request %d: %s %v (%v)", i, r.Kind, r.Decision, r.Err)
			}
		}
		hopBinds := reqs[1].Sign.SessionBinds
		if len(hopBinds) != 2 || !hopBinds[0].Forwarding || hopBinds[1].Forwarding ||
			!bytes.Equal(hopBinds[0].HostKey, hostBlob) || !bytes.Equal(hopBinds[1].HostKey, hostBlob) {
			t.Fatalf("second hop binds %+v, want the forwarding bind then the hop's own", hopBinds)
		}
	})

	// Go's SSH client, like Paramiko and libssh2, sends no session-bind. The
	// login works and the approver is told the destination is unknown.
	t.Run("client without session-bind", func(t *testing.T) {
		before := len(p.approver.Requests())
		agentConn, err := net.Dial("unix", p.paths.Socket)
		if err != nil {
			t.Fatal(err)
		}
		defer agentConn.Close()
		client, err := ssh.Dial("tcp", "127.0.0.1:"+server.port, &ssh.ClientConfig{
			User:            server.user,
			Auth:            []ssh.AuthMethod{ssh.PublicKeysCallback(sshagent.NewClient(agentConn).Signers)},
			HostKeyCallback: ssh.FixedHostKey(server.hostKey),
			Timeout:         5 * time.Second,
		})
		if err != nil {
			t.Fatalf("login with Go's SSH client: %v", err)
		}
		client.Close()
		reqs := p.approver.Requests()[before:]
		if len(reqs) == 0 {
			t.Fatal("no request reached the approver")
		}
		r := reqs[len(reqs)-1]
		if r.Kind != approvertest.KindUserauth || !r.DestinationUnknown || len(r.Sign.SessionBinds) != 0 || r.Decision != approvertest.Approve {
			t.Fatalf("kind %s, destination unknown %v, %d binds, %v", r.Kind, r.DestinationUnknown, len(r.Sign.SessionBinds), r.Decision)
		}
	})

	t.Run("denied login fails", func(t *testing.T) {
		p.approver.SetPolicy(approvertest.Delay(0, approvertest.Deny))
		defer p.approver.SetPolicy(nil)
		before := len(p.approver.Requests())
		if out, err := server.login(p, nil, "echo logged-in"); err == nil {
			t.Fatalf("login succeeded after a denial: %q", out)
		}
		reqs := p.approver.Requests()[before:]
		if len(reqs) == 0 || reqs[0].Decision != approvertest.Deny {
			t.Fatalf("the approver didn't deny the login: %+v", reqs)
		}
	})
}
