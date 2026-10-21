package serverkit

import (
	"sync"
	"time"
)

// RateLimiter is a fixed-window counter per key. It is in memory, so each
// replica limits on its own; that's fine for one SQLite-backed instance.
type RateLimiter struct {
	mu      sync.Mutex
	window  time.Duration
	maxKeys int
	now     func() time.Time
	windows map[string]*rateWindow
}

// overflowKey is shared by every new client once the limiter is full, so a
// flood of distinct addresses can't grow memory or escape limits.
const overflowKey = "~overflow"

type rateWindow struct {
	start time.Time
	count int
}

// NewRateLimiter counts per window. now may be nil for the real clock.
func NewRateLimiter(window time.Duration, now func() time.Time) *RateLimiter {
	if now == nil {
		now = time.Now
	}
	return &RateLimiter{window: window, maxKeys: 100_000, now: now, windows: map[string]*rateWindow{}}
}

// Allow counts one event for key and reports whether it stays within limit.
func (l *RateLimiter) Allow(key string, limit int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	w := l.windows[key]
	if w == nil && len(l.windows) >= l.maxKeys {
		l.pruneLocked(now)
		if len(l.windows) >= l.maxKeys {
			key = overflowKey
			w = l.windows[key]
		}
	}
	if w == nil || now.Sub(w.start) >= l.window {
		l.windows[key] = &rateWindow{start: now, count: 1}
		return true
	}
	if w.count >= limit {
		return false
	}
	w.count++
	return true
}

// Prune forgets finished windows.
func (l *RateLimiter) Prune() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(l.now())
}

func (l *RateLimiter) pruneLocked(now time.Time) {
	for key, w := range l.windows {
		if now.Sub(w.start) >= l.window {
			delete(l.windows, key)
		}
	}
}
