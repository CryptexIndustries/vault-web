package serverkit

import (
	"net"
	"net/http"
	"time"
)

// Healthcheck asks the server on listenAddr for /healthz and returns the
// exit code for the container's health check: 0 for 204, 1 otherwise. The
// distroless images have no shell or wget, so each binary checks itself.
func Healthcheck(listenAddr string) int {
	_, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return 1
	}
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return 1
	}
	return 0
}
