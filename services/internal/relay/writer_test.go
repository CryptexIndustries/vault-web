package relay

import (
	"net"
	"net/http/httptest"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// gatedConn blocks writes once limit bytes went out, until release closes.
type gatedConn struct {
	net.Conn
	written atomic.Int64
	limit   atomic.Int64
	blocked chan struct{}
	release chan struct{}
}

func (g *gatedConn) Write(b []byte) (int, error) {
	if limit := g.limit.Load(); limit > 0 && g.written.Load()+int64(len(b)) > limit {
		select {
		case g.blocked <- struct{}{}:
		default:
		}
		<-g.release
	}
	n, err := g.Conn.Write(b)
	g.written.Add(int64(n))
	return n, err
}

type gatedListener struct {
	net.Listener
	accepted chan *gatedConn
}

func (l *gatedListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	g := &gatedConn{Conn: c, blocked: make(chan struct{}, 1), release: make(chan struct{})}
	l.accepted <- g
	return g, nil
}

// Once the writer has taken an envelope from a backlog and released its
// budget charge, the backlog must not keep it in memory while a later write
// blocks: the recipient can Ack everything early and the budget would read
// zero with the whole backlog still held.
func TestWriterDropsTakenBacklogEntries(t *testing.T) {
	const count, size = 16, 60000
	h := newHarness(t, AuthToken, nil)
	h.ts.Close()
	server := httptest.NewUnstartedServer(h.s.Handler())
	listener := &gatedListener{Listener: server.Listener, accepted: make(chan *gatedConn, 8)}
	server.Listener = listener
	server.Start()
	h.ts = server
	f := h.fixture()
	<-listener.accepted // approver
	<-listener.accepted // agent
	f.g.ws.CloseNow()
	h.waitOffline(f.agent)

	envs := make([]*agentpb.Envelope, count)
	total := 0
	for i := range envs {
		envs[i] = h.sealSized(f.approver, f.agent, size)
		total += proto.Size(deliverFrame(envs[i])) + 10
		if st := f.a.status(sendFrame(envs[i])); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	var collected atomic.Int32
	h.locked(func() {
		for _, e := range h.s.mailboxes[string(f.agent.ID())].queued {
			runtime.SetFinalizer(e, func(*entry) { collected.Add(1) })
		}
	})

	// The backlog goes out on sign-in; the gate stops it at the last frame.
	g := h.dial("/v1/connect", nil)
	gate := <-listener.accepted
	defer close(gate.release)
	h.waitFor("the Challenge", func() bool { return gate.written.Load() > 0 })
	gate.limit.Store(gate.written.Load() + int64(total-size/2))
	if reply := h.auth(g, f.agent, authOptions{role: agentpb.Role_ROLE_AGENT, token: testToken}); reply.GetReady() == nil {
		t.Fatalf("got %v, want Ready", reply)
	}
	select {
	case <-gate.blocked:
	case <-time.After(frameWait):
		t.Fatal("the writer never blocked")
	}
	for _, env := range envs {
		g.ack(env)
	}
	h.waitFor("every Ack", func() bool { return h.queueBytes() == 0 })

	// All but the frame being written are collectible now; that one is
	// held as marshalled bytes, which is fine either way.
	deadline := time.Now().Add(2 * time.Second)
	for collected.Load() < count-1 && time.Now().Before(deadline) {
		runtime.GC()
		time.Sleep(10 * time.Millisecond)
	}
	if n := collected.Load(); n < count-1 {
		t.Fatalf("only %d of %d acked envelopes were freed while the writer was blocked", n, count)
	}
}
