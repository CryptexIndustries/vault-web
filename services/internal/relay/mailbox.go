package relay

import (
	"slices"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const (
	// maxQueued and maxQueuedBytes cap non-retained envelopes waiting for
	// one recipient.
	maxQueued      = 64
	maxQueuedBytes = 1 << 20
	// maxQueuedUnseen replaces maxQueued for an agent that has never
	// authenticated: next to its one retained KeysUpdate it needs at most
	// one more. Otherwise made-up agent keys, which nobody will ever collect
	// for, would be cheap storage.
	maxQueuedUnseen = 1
	// maxSeen caps the message IDs remembered per sender and recipient for
	// duplicate detection. It also bounds how fast one sender can push
	// envelopes. Counting per sender keeps one busy agent from blocking its
	// approver's other agents.
	maxSeen = 1024
)

// entry is one envelope waiting for its recipient's Ack.
type entry struct {
	env       *agentpb.Envelope
	sender    string
	messageID string
	// account is what the envelope counts against; see accountLocked.
	account string
	// dropAt is the header's expires_at plus the clock skew the recipient
	// also tolerates.
	dropAt   time.Time
	retained bool
	// dbID is the retained row, so an Ack deletes exactly this one.
	dbID int64
	// size is the serialized envelope, counted against the byte caps.
	size int
	// stored is set while the entry is in a mailbox, and outRefs counts the
	// outbound items still holding it. Its bytes leave the budget once both
	// are done: a replaced or acked envelope that is still queued for a
	// slow writer is still in memory. Both are guarded by Server.mu.
	stored  bool
	outRefs int
}

// queueBudget totals the bytes of every envelope held in memory, in a
// mailbox or an outbound queue, for the relay-wide budget and the one per
// account.
type queueBudget struct {
	total    int64
	accounts map[string]int64
}

// unhold returns e's bytes once nothing holds it any more.
func (b *queueBudget) unhold(e *entry) {
	if !e.stored && e.outRefs == 0 {
		b.add(e.account, -int64(e.size))
	}
}

func (b *queueBudget) add(account string, n int64) {
	b.total += n
	if v := b.accounts[account] + n; v != 0 {
		b.accounts[account] = v
	} else {
		delete(b.accounts, account)
	}
}

// seenID is a remembered message ID: who sent it and until when.
type seenID struct {
	sender string
	until  time.Time
}

// mailbox holds everything addressed to one key. Retained envelopes are also
// in SQLite; the rest lives only here and is lost on restart, which the
// protocol allows: requests last 90 seconds and agents resend.
type mailbox struct {
	retained []*entry
	queued   []*entry
	// seen remembers non-retained message IDs until they expire, so a
	// replayed envelope is refused even after it was acked. seenFrom counts
	// them per sender.
	seen     map[string]seenID
	seenFrom map[string]int
	// queuedBytes is the size of queued, for the per-recipient cap; budget
	// is the server's, shared by every mailbox.
	queuedBytes int
	budget      *queueBudget
}

func (s *Server) mailboxLocked(key string) *mailbox {
	mb := s.mailboxes[key]
	if mb == nil {
		mb = &mailbox{seen: map[string]seenID{}, seenFrom: map[string]int{}, budget: &s.budget}
		s.mailboxes[key] = mb
	}
	return mb
}

// dropMailboxLocked deletes a mailbox and returns its bytes to the budget.
func (s *Server) dropMailboxLocked(key string) {
	if mb := s.mailboxes[key]; mb != nil {
		mb.retained = mb.removeFunc(mb.retained, func(*entry) bool { return true })
		mb.queued = mb.removeFunc(mb.queued, func(*entry) bool { return true })
		delete(s.mailboxes, key)
	}
}

// expireMailboxesLocked drops expired envelopes and empty mailboxes, and
// returns how many envelopes went undelivered.
func (s *Server) expireMailboxesLocked(now time.Time) int {
	n := 0
	for key, mb := range s.mailboxes {
		n += mb.expire(now)
		if mb.empty() {
			s.dropMailboxLocked(key)
		}
	}
	return n
}

// deliverAllLocked queues everything waiting for p, retained first, then by
// arrival. Called as p goes live, before anything new can arrive for it. The
// backlog goes to the writer as one item that it writes with flow control:
// a recipient with more waiting than the outbound buffer holds would
// otherwise be dropped on every reconnect.
func (s *Server) deliverAllLocked(p *peer) {
	mb := s.mailboxes[p.key]
	if mb == nil {
		return
	}
	// A copy, because the lists are edited in place under the lock while the
	// writer works through it.
	backlog := make([]*entry, 0, len(mb.retained)+len(mb.queued))
	backlog = append(backlog, mb.retained...)
	backlog = append(backlog, mb.queued...)
	if len(backlog) > 0 {
		p.deliverLocked(backlog)
	}
}

// add and forget keep the byte counts in step with the lists; every change
// to retained or queued goes through one of them.
func (mb *mailbox) add(e *entry) {
	if e.retained {
		mb.retained = append(mb.retained, e)
	} else {
		mb.queued = append(mb.queued, e)
		mb.queuedBytes += e.size
	}
	e.stored = true
	mb.budget.add(e.account, int64(e.size))
}

func (mb *mailbox) forget(e *entry) {
	if !e.retained {
		mb.queuedBytes -= e.size
	}
	e.stored = false
	mb.budget.unhold(e)
}

// removeFunc deletes the entries del matches from list.
func (mb *mailbox) removeFunc(list []*entry, del func(*entry) bool) []*entry {
	return slices.DeleteFunc(list, func(e *entry) bool {
		if !del(e) {
			return false
		}
		mb.forget(e)
		return true
	})
}

func (mb *mailbox) remove(e *entry) {
	is := func(x *entry) bool { return x == e }
	if e.retained {
		mb.retained = mb.removeFunc(mb.retained, is)
	} else {
		mb.queued = mb.removeFunc(mb.queued, is)
	}
}

func (mb *mailbox) has(messageID string) bool {
	if _, ok := mb.seen[messageID]; ok {
		return true
	}
	return slices.ContainsFunc(mb.retained, func(e *entry) bool { return e.messageID == messageID })
}

// find returns the waiting entry with this message ID, or nil.
func (mb *mailbox) find(messageID string) *entry {
	match := func(e *entry) bool { return e.messageID == messageID }
	if i := slices.IndexFunc(mb.queued, match); i >= 0 {
		return mb.queued[i]
	}
	if i := slices.IndexFunc(mb.retained, match); i >= 0 {
		return mb.retained[i]
	}
	return nil
}

// room checks e against this recipient's caps and returns how many budget
// bytes storing it frees: a retained envelope replaces its sender's older
// one, unless an outbound queue still holds that one.
// queuedCap is maxQueued, or maxQueuedUnseen for an agent that never
// authenticated.
func (mb *mailbox) room(e *entry, retainedCap, queuedCap int) (freed int, failure *refusal) {
	if e.retained {
		if i := slices.IndexFunc(mb.retained, func(old *entry) bool { return old.sender == e.sender }); i >= 0 {
			if old := mb.retained[i]; old.outRefs == 0 {
				return old.size, nil
			}
			return 0, nil
		}
		if len(mb.retained) >= retainedCap {
			return 0, refuse(agentpb.Status_STATUS_LIMIT_REACHED, "too many retained envelopes are waiting for this recipient")
		}
		return 0, nil
	}
	if len(mb.queued) >= queuedCap || mb.queuedBytes+e.size > maxQueuedBytes {
		return 0, refuse(agentpb.Status_STATUS_LIMIT_REACHED, "too many envelopes are waiting for this recipient")
	}
	if mb.seenFrom[e.sender] >= maxSeen {
		return 0, refuse(agentpb.Status_STATUS_LIMIT_REACHED, "too many envelopes were sent to this recipient recently")
	}
	return 0, nil
}

// put stores an entry that room accepted.
func (mb *mailbox) put(e *entry) {
	if e.retained {
		mb.retained = mb.removeFunc(mb.retained, func(old *entry) bool { return old.sender == e.sender })
	} else {
		mb.seen[e.messageID] = seenID{sender: e.sender, until: e.dropAt}
		mb.seenFrom[e.sender]++
	}
	mb.add(e)
}

// expire drops entries past their deadline and returns how many envelopes
// went undelivered. Retained rows are deleted by the store sweep.
func (mb *mailbox) expire(now time.Time) int {
	n := 0
	keep := func(list []*entry) []*entry {
		return mb.removeFunc(list, func(e *entry) bool {
			if now.Before(e.dropAt) {
				return false
			}
			n++
			return true
		})
	}
	mb.retained = keep(mb.retained)
	mb.queued = keep(mb.queued)
	for id, seen := range mb.seen {
		if now.Before(seen.until) {
			continue
		}
		delete(mb.seen, id)
		if mb.seenFrom[seen.sender]--; mb.seenFrom[seen.sender] <= 0 {
			delete(mb.seenFrom, seen.sender)
		}
	}
	return n
}

func (mb *mailbox) empty() bool {
	return len(mb.retained) == 0 && len(mb.queued) == 0 && len(mb.seen) == 0
}

// dropFrom removes everything a removed agent sent.
func (mb *mailbox) dropFrom(sender string) {
	from := func(e *entry) bool { return e.sender == sender }
	mb.retained = mb.removeFunc(mb.retained, from)
	mb.queued = mb.removeFunc(mb.queued, from)
}
