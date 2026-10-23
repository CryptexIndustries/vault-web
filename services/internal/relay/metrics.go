package relay

import (
	"net/http"
	"strconv"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// metrics are served on a separate listener that is never published or
// proxied. Labels come from fixed sets: never keys, slot IDs, subjects or
// client addresses.
type metrics struct {
	registry     *prometheus.Registry
	connections  *prometheus.CounterVec
	open         *prometheus.GaugeVec
	authRejected *prometheus.CounterVec
	frames       *prometheus.CounterVec
	sends        *prometheus.CounterVec
	deliveries   prometheus.Counter
	expired      prometheus.Counter
	slots        prometheus.Gauge
	slotOutcomes *prometheus.CounterVec
	revokes      *prometheus.CounterVec
	revokeHTTP   *prometheus.CounterVec
	rateLimited  *prometheus.CounterVec
	sweeps       *prometheus.CounterVec
}

// Label values, so call sites and the zero series below agree.
const (
	// Connection roles. "pairing" is a /v1/pair socket; "pending" is a
	// /v1/connect socket that hasn't authenticated yet.
	labelAgent    = "agent"
	labelApprover = "approver"
	labelPairing  = "pairing"
	labelPending  = "pending"

	// How pairing slots end.
	slotAnswered = "answered"
	slotExpired  = "expired"
	slotClosed   = "closed"

	// Why agents were removed.
	revokedByApprover  = "approver"
	revokedByAgent     = "agent"
	revokedByKey       = "revocation_key"
	revokedPassExpired = "pass_expired"
	revokedReplaced    = "replaced"

	// Rate limit buckets.
	bucketConnect               = "connect"
	bucketConnectPending        = "connect_pending"
	bucketConnectPendingAddress = "connect_pending_address"
	bucketConnectPendingNetwork = "connect_pending_network"
	bucketPairConnect           = "pair_connect"
	bucketPairSocket            = "pair_socket"
	bucketPairSocketNetwork     = "pair_socket_network"
	bucketOpenSlot              = "open_slot"
	bucketRevoke                = "revoke"
	bucketRegister              = "register_agent"
	bucketUnregister            = "unregister_agent"
)

func newMetrics(s *Server) *metrics {
	m := &metrics{
		registry: prometheus.NewRegistry(),
		connections: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_connections_total",
			Help: "WebSocket connections by role: agent and approver after Auth, pairing for /v1/pair.",
		}, []string{"role"}),
		open: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "cryptex_relay_open_connections",
			Help: "Open WebSocket connections by role, including pending ones that haven't authenticated.",
		}, []string{"role"}),
		authRejected: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_auth_rejected_total",
			Help: "Refused /v1/connect authentications by status.",
		}, []string{"status"}),
		frames: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_frames_total",
			Help: "Client frames received, by frame type.",
		}, []string{"type"}),
		sends: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_sends_total",
			Help: "Send frames by result status.",
		}, []string{"status"}),
		deliveries: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cryptex_relay_deliveries_total",
			Help: "Deliver frames written to clients, including redeliveries after a reconnect.",
		}),
		expired: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cryptex_relay_expired_envelopes_total",
			Help: "Queued envelopes dropped at their deadline without an Ack, by the sweeper or early to make room.",
		}),
		slots: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "cryptex_relay_pairing_slots",
			Help: "Open pairing slots.",
		}),
		slotOutcomes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_slot_outcomes_total",
			Help: "Pairing slots by how they ended: answered, expired or closed.",
		}, []string{"outcome"}),
		revokes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_revokes_total",
			Help: "Agents removed, by source: approver, agent, revocation_key, pass_expired or replaced.",
		}, []string{"source"}),
		revokeHTTP: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_revoke_requests_total",
			Help: "POST /v1/revoke requests by HTTP status code.",
		}, []string{"status"}),
		rateLimited: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_rate_limited_total",
			Help: "Requests refused by a per-address, per-network or per-approver limit, or by the cap on unauthenticated connections (connect_pending), by bucket.",
		}, []string{"bucket"}),
		sweeps: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_relay_sweeps_total",
			Help: "Database sweeper runs by result.",
		}, []string{"result"}),
	}
	registered := func(count func() int) func() float64 {
		return func() float64 {
			s.mu.Lock()
			defer s.mu.Unlock()
			return float64(count())
		}
	}
	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.connections, m.open, m.authRejected, m.frames, m.sends, m.deliveries, m.expired,
		m.slots, m.slotOutcomes, m.revokes, m.revokeHTTP, m.rateLimited, m.sweeps,
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "cryptex_relay_registered_agents",
			Help: "Agents registered on the relay.",
		}, registered(func() int { return len(s.agents) })),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "cryptex_relay_registered_approvers",
			Help: "Approvers recorded on the relay.",
		}, registered(func() int { return len(s.approvers) })),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "cryptex_relay_retained_envelopes",
			Help: "Retained envelopes waiting for their recipient.",
		}, registered(func() int {
			n := 0
			for _, mb := range s.mailboxes {
				n += len(mb.retained)
			}
			return n
		})),
	)
	// Roles, outcomes and sources start at zero, so dashboards and alerts
	// see the series before the first event.
	for _, role := range []string{labelAgent, labelApprover, labelPairing} {
		m.connections.WithLabelValues(role)
	}
	for _, role := range []string{labelAgent, labelApprover, labelPairing, labelPending} {
		m.open.WithLabelValues(role)
	}
	for _, outcome := range []string{slotAnswered, slotExpired, slotClosed} {
		m.slotOutcomes.WithLabelValues(outcome)
	}
	for _, source := range []string{revokedByApprover, revokedByAgent, revokedByKey, revokedPassExpired, revokedReplaced} {
		m.revokes.WithLabelValues(source)
	}
	for _, result := range []string{"ok", "error"} {
		m.sweeps.WithLabelValues(result)
	}
	// The statuses authenticate refuses with.
	for _, st := range []agentpb.Status{
		agentpb.Status_STATUS_BAD_REQUEST, agentpb.Status_STATUS_UNAUTHORIZED, agentpb.Status_STATUS_REVOKED,
		agentpb.Status_STATUS_NOT_FOUND, agentpb.Status_STATUS_UNAVAILABLE,
	} {
		m.authRejected.WithLabelValues(statusLabel(st))
	}
	for _, bucket := range []string{
		bucketConnect, bucketConnectPending, bucketConnectPendingAddress, bucketConnectPendingNetwork,
		bucketPairConnect, bucketPairSocket, bucketPairSocketNetwork, bucketOpenSlot,
		bucketRevoke, bucketRegister, bucketUnregister,
	} {
		m.rateLimited.WithLabelValues(bucket)
	}
	return m
}

func (m *metrics) opened(role string) { m.open.WithLabelValues(role).Inc() }
func (m *metrics) closed(role string) { m.open.WithLabelValues(role).Dec() }

// connected counts a connection once its role is known.
func (m *metrics) connected(role string) { m.connections.WithLabelValues(role).Inc() }

// relabel moves an open connection to the role it authenticated as.
func (m *metrics) relabel(from, to string) {
	m.closed(from)
	m.opened(to)
	m.connected(to)
}

func (m *metrics) received(f *agentpb.ClientFrame) {
	m.frames.WithLabelValues(frameLabel(f)).Inc()
}

func (m *metrics) authRefused(st agentpb.Status) {
	m.authRejected.WithLabelValues(statusLabel(st)).Inc()
}

// sent counts a Send by the status it got.
func (m *metrics) sent(failure *refusal) {
	status := agentpb.Status_STATUS_OK
	if failure != nil {
		status = failure.status
	}
	m.sends.WithLabelValues(statusLabel(status)).Inc()
}

func (m *metrics) delivered()               { m.deliveries.Inc() }
func (m *metrics) expiredEnvelopes(n int)   { m.expired.Add(float64(n)) }
func (m *metrics) slotOpened()              { m.slots.Inc() }
func (m *metrics) revoked(source string)    { m.revokes.WithLabelValues(source).Inc() }
func (m *metrics) limited(bucket string)    { m.rateLimited.WithLabelValues(bucket).Inc() }
func (m *metrics) revokeRequest(status int) { m.revokeHTTP.WithLabelValues(strconv.Itoa(status)).Inc() }

func (m *metrics) slotEnded(outcome string) {
	m.slots.Dec()
	m.slotOutcomes.WithLabelValues(outcome).Inc()
}

func (m *metrics) swept(err error) {
	result := "ok"
	if err != nil {
		result = "error"
	}
	m.sweeps.WithLabelValues(result).Inc()
}

func (m *metrics) handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{
		ErrorHandling: promhttp.ContinueOnError,
		// One scrape at a time; extra ones get 503 instead of piling up.
		MaxRequestsInFlight: 1,
	}))
	return mux
}

// statusLabel turns a Status into a short label such as "ok" or "not_found".
func statusLabel(st agentpb.Status) string {
	switch st {
	case agentpb.Status_STATUS_OK:
		return "ok"
	case agentpb.Status_STATUS_BAD_REQUEST:
		return "bad_request"
	case agentpb.Status_STATUS_UNAUTHORIZED:
		return "unauthorized"
	case agentpb.Status_STATUS_NOT_FOUND:
		return "not_found"
	case agentpb.Status_STATUS_LIMIT_REACHED:
		return "limit_reached"
	case agentpb.Status_STATUS_EXPIRED:
		return "expired"
	case agentpb.Status_STATUS_REVOKED:
		return "revoked"
	case agentpb.Status_STATUS_TOO_LARGE:
		return "too_large"
	case agentpb.Status_STATUS_RATE_LIMITED:
		return "rate_limited"
	case agentpb.Status_STATUS_ALREADY_CLAIMED:
		return "already_claimed"
	case agentpb.Status_STATUS_UNAVAILABLE:
		return "unavailable"
	}
	return "other"
}

// frameLabel names a client frame type without looking at its contents.
func frameLabel(f *agentpb.ClientFrame) string {
	switch f.GetFrame().(type) {
	case *agentpb.ClientFrame_Auth:
		return "auth"
	case *agentpb.ClientFrame_Send:
		return "send"
	case *agentpb.ClientFrame_Ack:
		return "ack"
	case *agentpb.ClientFrame_Ping:
		return "ping"
	case *agentpb.ClientFrame_RegisterAgent:
		return "register_agent"
	case *agentpb.ClientFrame_UnregisterAgent:
		return "unregister_agent"
	case *agentpb.ClientFrame_RenewPass:
		return "renew_pass"
	case *agentpb.ClientFrame_OpenSlot:
		return "open_slot"
	case *agentpb.ClientFrame_ClaimSlot:
		return "claim_slot"
	case *agentpb.ClientFrame_AnswerSlot:
		return "answer_slot"
	}
	return "unknown"
}
