package share

import (
	"sync"
	"time"
)

// rateLimiter is a fixed-window counter per key. It is in-memory, so each
// replica limits on its own; that's fine for one SQLite-backed instance.
type rateLimiter struct {
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

func newRateLimiter(window time.Duration) *rateLimiter {
	return &rateLimiter{window: window, maxKeys: 100_000, now: time.Now, windows: map[string]*rateWindow{}}
}

func (l *rateLimiter) allow(key string, limit int) bool {
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

func (l *rateLimiter) prune() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(l.now())
}

func (l *rateLimiter) pruneLocked(now time.Time) {
	for key, w := range l.windows {
		if now.Sub(w.start) >= l.window {
			delete(l.windows, key)
		}
	}
}
