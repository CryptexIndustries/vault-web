package share

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics are served on a separate listener that is never published or
// proxied. Labels never carry share IDs, account subjects or client addresses.
type Metrics struct {
	registry    *prometheus.Registry
	requests    *prometheus.CounterVec
	duration    *prometheus.HistogramVec
	created     *prometheus.CounterVec
	rejected    *prometheus.CounterVec
	events      *prometheus.CounterVec
	rateLimited *prometheus.CounterVec
	sweeps      *prometheus.CounterVec
	storeStats  *storeCollector
}

// NewMetrics registers the share server's metrics and reports store events
// and stored share counts.
func NewMetrics(store *Store, logger *slog.Logger) *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_share_http_requests_total",
			Help: "Share API requests by route pattern, method and status code.",
		}, []string{"route", "method", "status"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "cryptex_share_http_request_duration_seconds",
			Help:    "Share API request duration by route pattern.",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		}, []string{"route"}),
		created: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_share_created_total",
			Help: "Shares created, by creation auth mode.",
		}, []string{"auth"}),
		rejected: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_share_create_rejected_total",
			Help: "Refused create requests by reason.",
		}, []string{"reason"}),
		events: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_share_events_total",
			Help: "Share state changes: opened, revoked, burned, passphrase_failed, reveal_rejected, expired, forgotten.",
		}, []string{"event"}),
		rateLimited: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_share_rate_limited_total",
			Help: "Requests refused by the per-address rate limiter, by bucket.",
		}, []string{"bucket"}),
		sweeps: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cryptex_share_sweeps_total",
			Help: "Sweeper runs by result.",
		}, []string{"result"}),
	}
	m.storeStats = &storeCollector{store: store, logger: logger, now: time.Now}
	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.requests, m.duration, m.created, m.rejected, m.events, m.rateLimited, m.sweeps,
		m.storeStats,
	)
	store.observe = func(event string, n int) {
		m.events.WithLabelValues(event).Add(float64(n))
	}
	// Both results start at zero, so an alert sees the first failed sweep.
	for _, result := range []string{"ok", "error"} {
		m.sweeps.WithLabelValues(result)
	}
	return m
}

// Handler serves the metrics in the Prometheus text format.
func (m *Metrics) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{
		ErrorHandling: promhttp.ContinueOnError,
		// One scrape at a time; extra ones get 503 instead of piling up.
		MaxRequestsInFlight: 1,
	}))
	return mux
}

// The methods below accept a nil *Metrics, so tests and callers without
// metrics need no checks.

func (m *Metrics) observeRequest(pattern, method string, status int, took time.Duration) {
	if m == nil {
		return
	}
	route := routeLabel(pattern)
	m.requests.WithLabelValues(route, method, strconv.Itoa(status)).Inc()
	m.duration.WithLabelValues(route).Observe(took.Seconds())
}

func (m *Metrics) shareCreated(auth string) {
	if m != nil {
		m.created.WithLabelValues(auth).Inc()
	}
}

func (m *Metrics) createRejected(reason string) {
	if m != nil {
		m.rejected.WithLabelValues(reason).Inc()
	}
}

func (m *Metrics) rateLimitHit(bucket string) {
	if m != nil {
		m.rateLimited.WithLabelValues(bucket).Inc()
	}
}

func (m *Metrics) sweepDone(err error) {
	if m == nil {
		return
	}
	result := "ok"
	if err != nil {
		result = "error"
	}
	m.sweeps.WithLabelValues(result).Inc()
}

// routeLabel keeps the path of a mux pattern such as
// "POST /share-api/v1/shares/{id}/peek", so the label set stays bounded.
func routeLabel(pattern string) string {
	if pattern == "" {
		return "unmatched"
	}
	if _, path, ok := strings.Cut(pattern, " "); ok {
		return path
	}
	return pattern
}

// storeStatsTTL is how long the share counts and database size are reused, so
// frequent scrapes don't keep the store's only connection busy.
const storeStatsTTL = 15 * time.Second

// storeCollector reads share counts and the database size, at most once per
// storeStatsTTL.
type storeCollector struct {
	store  *Store
	logger *slog.Logger
	now    func() time.Time

	mu       sync.Mutex
	readAt   time.Time
	counts   map[string]int
	countErr error
	size     int64
	sizeErr  error
}

var (
	sharesDesc = prometheus.NewDesc("cryptex_share_shares",
		"Stored shares by status, including tombstones kept for status reports.", []string{"status"}, nil)
	databaseBytesDesc = prometheus.NewDesc("cryptex_share_database_bytes",
		"Size of the SQLite database file, without the write-ahead log.", nil, nil)
)

func (c *storeCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- sharesDesc
	ch <- databaseBytesDesc
}

func (c *storeCollector) refresh() {
	now := c.now()
	if !c.readAt.IsZero() && now.Sub(c.readAt) < storeStatsTTL {
		return
	}
	// The store has one connection; don't let a scrape queue behind writes for long.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c.counts, c.countErr = c.store.ShareCounts(ctx)
	if c.countErr != nil {
		c.logger.Error("metrics: count shares", "error", c.countErr)
	}
	c.size, c.sizeErr = c.store.SizeBytes(ctx)
	if c.sizeErr != nil {
		c.logger.Error("metrics: database size", "error", c.sizeErr)
	}
	c.readAt = now
}

func (c *storeCollector) Collect(ch chan<- prometheus.Metric) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.refresh()
	if c.countErr != nil {
		ch <- prometheus.NewInvalidMetric(sharesDesc, c.countErr)
	} else {
		for _, status := range []string{StatusActive, StatusViewed, StatusExpired, StatusRevoked, StatusBurned} {
			ch <- prometheus.MustNewConstMetric(sharesDesc, prometheus.GaugeValue, float64(c.counts[status]), status)
		}
	}
	if c.sizeErr != nil {
		ch <- prometheus.NewInvalidMetric(databaseBytesDesc, c.sizeErr)
		return
	}
	ch <- prometheus.MustNewConstMetric(databaseBytesDesc, prometheus.GaugeValue, float64(c.size))
}
