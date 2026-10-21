package relayclient

import (
	"math/rand/v2"
	"time"
)

// Backoff spaces out reconnects: 1 s doubling to 60 s, each wait randomized
// down to half so clients that lost the relay together don't return
// together.
type Backoff struct{ next time.Duration }

// NewBackoff returns the relay clients' default schedule.
func NewBackoff() *Backoff { return &Backoff{} }

// Next returns the wait before the next attempt.
func (b *Backoff) Next() time.Duration {
	d := max(b.next, time.Second)
	b.next = min(d*2, time.Minute)
	return d/2 + rand.N(d/2+1)
}

// Reset starts over after a connection that worked.
func (b *Backoff) Reset() { b.next = 0 }
