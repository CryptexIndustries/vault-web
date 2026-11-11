package agent

import "testing"

func TestDefaultPaths(t *testing.T) {
	env := map[string]string{"HOME": "/home/u", "XDG_DATA_HOME": "relative/ignored", "XDG_RUNTIME_DIR": "/run/user/1000"}
	p, err := pathsFor("linux", func(k string) string { return env[k] })
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
	p, _ = pathsFor("linux", func(k string) string { return env[k] })
	if p.DataDir != "/data/cryptex-agent" || p.ConfigFile != "/cfg/cryptex-agent/config" || p.Socket != "" {
		t.Fatalf("paths = %+v", p)
	}
	if _, err := DefaultPaths(func(string) string { return "" }); err == nil {
		t.Fatal("no error without HOME")
	}
}

func TestDefaultPathsOnMacOS(t *testing.T) {
	env := map[string]string{"HOME": "/Users/u", "XDG_DATA_HOME": "/data", "XDG_CONFIG_HOME": "/cfg", "XDG_RUNTIME_DIR": "/run/user/501"}
	p, err := pathsFor("darwin", func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	want := Paths{
		DataDir:    "/Users/u/.local/share/cryptex-agent",
		ConfigFile: "/Users/u/.config/cryptex-agent/config",
		Socket:     "/Users/u/.local/share/cryptex-agent/cryptex-agent.sock",
	}
	if p != want {
		t.Fatalf("paths = %+v", p)
	}
}
