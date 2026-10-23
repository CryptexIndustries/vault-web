package agent

import "testing"

func TestDefaultPaths(t *testing.T) {
	env := map[string]string{"HOME": "/home/u", "XDG_DATA_HOME": "relative/ignored", "XDG_RUNTIME_DIR": "/run/user/1000"}
	p, err := DefaultPaths(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	want := Paths{
		DataDir:    "/home/u/.local/share/cryptex-agent",
		ConfigFile: "/home/u/.config/cryptex-agent/config",
		Socket:     "/run/user/1000/cryptex-agent.sock",
	}
	if p != want {
		t.Fatalf("paths = %+v", p)
	}
	env = map[string]string{"HOME": "/home/u", "XDG_DATA_HOME": "/data", "XDG_CONFIG_HOME": "/cfg"}
	p, _ = DefaultPaths(func(k string) string { return env[k] })
	if p.DataDir != "/data/cryptex-agent" || p.ConfigFile != "/cfg/cryptex-agent/config" || p.Socket != "" {
		t.Fatalf("paths = %+v", p)
	}
	if _, err := DefaultPaths(func(string) string { return "" }); err == nil {
		t.Fatal("no error without HOME")
	}
}
