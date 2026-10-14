package share

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Share statuses. "expired" is stored once the sweeper or a request notices
// the deadline passed.
const (
	StatusActive  = "active"
	StatusViewed  = "viewed"
	StatusExpired = "expired"
	StatusRevoked = "revoked"
	StatusBurned  = "burned"
	StatusUnknown = "unknown"
)

// MaxPassphraseAttempts is how many wrong reveal tokens a passphrase share
// accepts before it burns.
const MaxPassphraseAttempts = 5

var (
	ErrGone            = errors.New("gone")
	ErrWrongPassphrase = errors.New("wrong passphrase")
	ErrForbidden       = errors.New("forbidden")
	ErrLimitReached    = errors.New("limit reached")
	ErrTicketReused    = errors.New("ticket reused")
	ErrTicketExpired   = errors.New("ticket expired")
)

type Store struct {
	db  *sql.DB
	now func() time.Time
	// observe receives state changes after they commit; see Metrics.
	observe func(event string, n int)
}

// Store events reported to observe.
const (
	EventOpened           = "opened"
	EventRevoked          = "revoked"
	EventBurned           = "burned"
	EventPassphraseFailed = "passphrase_failed"
	EventRevealRejected   = "reveal_rejected"
	EventExpired          = "expired"
	EventForgotten        = "forgotten"
)

func (s *Store) emit(event string, n int) {
	if s.observe != nil && n > 0 {
		s.observe(event, n)
	}
}

type NewShare struct {
	Owner      string
	Ciphertext []byte
	PeekHash   []byte
	RevealHash []byte
	ManageHash []byte
	Passphrase bool
	ExpiresAt  time.Time
	MaxActive  int
	// TicketID and TicketExpiry make a ticket single-use. Empty in token mode.
	TicketID     string
	TicketExpiry time.Time
}

type StatusReport struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	ExpiresAt *int64 `json:"expiresAt"`
	ViewedAt  *int64 `json:"viewedAt"`
}

const schema = `
CREATE TABLE IF NOT EXISTS shares (
	id TEXT PRIMARY KEY,
	owner TEXT NOT NULL,
	ciphertext BLOB,
	peek_hash BLOB NOT NULL,
	reveal_hash BLOB NOT NULL,
	manage_hash BLOB NOT NULL,
	passphrase INTEGER NOT NULL,
	status TEXT NOT NULL,
	failed_attempts INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	viewed_at INTEGER,
	finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS shares_owner_active ON shares (owner, status);
CREATE INDEX IF NOT EXISTS shares_expires ON shares (status, expires_at);
CREATE INDEX IF NOT EXISTS shares_finished ON shares (finished_at);
CREATE TABLE IF NOT EXISTS used_tickets (
	id TEXT PRIMARY KEY,
	expires_at INTEGER NOT NULL
);
`

// OpenStore opens (and creates) the SQLite database. Use ":memory:" in tests.
func OpenStore(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate", path)
	if path == ":memory:" {
		dsn = "file::memory:?_txlock=immediate"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows one writer; a single connection also keeps ":memory:" shared.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return &Store{db: db, now: time.Now}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newShareID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func hashesEqual(a, b []byte) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare(a, b) == 1
}

func (s *Store) Create(ctx context.Context, in NewShare) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	now := s.now()

	if in.TicketID != "" {
		// Recheck here: a slow upload can outlive the ticket and its
		// replay marker, which the sweeper deletes after expiry.
		if !now.Before(in.TicketExpiry) {
			return "", ErrTicketExpired
		}
		res, err := tx.ExecContext(ctx,
			`INSERT INTO used_tickets (id, expires_at) VALUES (?, ?) ON CONFLICT DO NOTHING`,
			in.TicketID, in.TicketExpiry.UnixMilli())
		if err != nil {
			return "", err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return "", ErrTicketReused
		}
	}

	var active int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM shares WHERE owner = ? AND status = ? AND expires_at > ?`,
		in.Owner, StatusActive, now.UnixMilli()).Scan(&active); err != nil {
		return "", err
	}
	if in.MaxActive > 0 && active >= in.MaxActive {
		return "", ErrLimitReached
	}

	id, err := newShareID()
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO shares
		(id, owner, ciphertext, peek_hash, reveal_hash, manage_hash, passphrase, status, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Owner, in.Ciphertext, in.PeekHash, in.RevealHash, in.ManageHash,
		in.Passphrase, StatusActive, now.UnixMilli(), in.ExpiresAt.UnixMilli()); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

type shareRow struct {
	peekHash, revealHash, manageHash []byte
	ciphertext                       []byte
	passphrase                       bool
	status                           string
	failedAttempts                   int
	expiresAt                        int64
	viewedAt                         sql.NullInt64
}

func (s *Store) load(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (*shareRow, error) {
	var r shareRow
	err := q.QueryRowContext(ctx, `SELECT peek_hash, reveal_hash, manage_hash, ciphertext,
		passphrase, status, failed_attempts, expires_at, viewed_at FROM shares WHERE id = ?`, id).
		Scan(&r.peekHash, &r.revealHash, &r.manageHash, &r.ciphertext, &r.passphrase,
			&r.status, &r.failedAttempts, &r.expiresAt, &r.viewedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrGone
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (r *shareRow) open(now time.Time) bool {
	return r.status == StatusActive && r.expiresAt > now.UnixMilli()
}

// Peek tells a link holder whether the share is still there and whether it
// needs a passphrase. Missing, finished and wrong-token shares all look gone.
func (s *Store) Peek(ctx context.Context, id string, peekHash []byte) (passphrase bool, expiresAt int64, err error) {
	r, err := s.load(ctx, s.db, id)
	if err != nil {
		return false, 0, err
	}
	if !hashesEqual(r.peekHash, peekHash) || !r.open(s.now()) {
		return false, 0, ErrGone
	}
	return r.passphrase, r.expiresAt, nil
}

// Reveal returns the ciphertext and deletes it in the same transaction.
func (s *Store) Reveal(ctx context.Context, id string, peekHash, revealHash []byte) (ciphertext []byte, attemptsLeft int, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()
	now := s.now()

	r, err := s.load(ctx, tx, id)
	if err != nil {
		return nil, 0, err
	}
	if !hashesEqual(r.peekHash, peekHash) || !r.open(now) {
		return nil, 0, ErrGone
	}
	if !hashesEqual(r.revealHash, revealHash) {
		failed := r.failedAttempts + 1
		left := MaxPassphraseAttempts - failed
		if left <= 0 {
			_, err = tx.ExecContext(ctx, `UPDATE shares SET status = ?, ciphertext = NULL,
				failed_attempts = ?, finished_at = ? WHERE id = ?`,
				StatusBurned, failed, now.UnixMilli(), id)
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE shares SET failed_attempts = ? WHERE id = ?`, failed, id)
		}
		if err != nil {
			return nil, 0, err
		}
		if err := tx.Commit(); err != nil {
			return nil, 0, err
		}
		if left <= 0 {
			s.emit(EventBurned, 1)
		}
		if !r.passphrase {
			s.emit(EventRevealRejected, 1)
			return nil, 0, ErrForbidden
		}
		s.emit(EventPassphraseFailed, 1)
		if left <= 0 {
			return nil, 0, ErrGone
		}
		return nil, left, ErrWrongPassphrase
	}

	if _, err := tx.ExecContext(ctx, `UPDATE shares SET status = ?, ciphertext = NULL,
		viewed_at = ?, finished_at = ? WHERE id = ?`,
		StatusViewed, now.UnixMilli(), now.UnixMilli(), id); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	s.emit(EventOpened, 1)
	return r.ciphertext, 0, nil
}

// Revoke ends an open share and reports the share's status afterwards. A
// share that already finished keeps its status, so a link opened just before
// the revoke still reports "viewed".
func (s *Store) Revoke(ctx context.Context, id string, manageHash []byte) (StatusReport, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return StatusReport{}, err
	}
	defer tx.Rollback()
	now := s.now()
	r, err := s.load(ctx, tx, id)
	if err != nil {
		return StatusReport{}, err
	}
	if !hashesEqual(r.manageHash, manageHash) {
		return StatusReport{}, ErrGone
	}
	if r.open(now) {
		if _, err := tx.ExecContext(ctx, `UPDATE shares SET status = ?, ciphertext = NULL,
			finished_at = ? WHERE id = ?`, StatusRevoked, now.UnixMilli(), id); err != nil {
			return StatusReport{}, err
		}
		if err := tx.Commit(); err != nil {
			return StatusReport{}, err
		}
		s.emit(EventRevoked, 1)
		r.status = StatusRevoked
	}
	return r.report(id, now), nil
}

func (r *shareRow) report(id string, now time.Time) StatusReport {
	report := StatusReport{ID: id, Status: r.status}
	if r.status == StatusActive && r.expiresAt <= now.UnixMilli() {
		report.Status = StatusExpired
	}
	expiresAt := r.expiresAt
	report.ExpiresAt = &expiresAt
	if r.viewedAt.Valid {
		viewedAt := r.viewedAt.Int64
		report.ViewedAt = &viewedAt
	}
	return report
}

type StatusQuery struct {
	ID         string
	ManageHash []byte
}

func (s *Store) Status(ctx context.Context, queries []StatusQuery) ([]StatusReport, error) {
	now := s.now()
	reports := make([]StatusReport, 0, len(queries))
	for _, q := range queries {
		report := StatusReport{ID: q.ID, Status: StatusUnknown}
		r, err := s.load(ctx, s.db, q.ID)
		if err != nil && !errors.Is(err, ErrGone) {
			return nil, err
		}
		if err == nil && hashesEqual(r.manageHash, q.ManageHash) {
			report = r.report(q.ID, now)
		}
		reports = append(reports, report)
	}
	return reports, nil
}

// Sweep drops ciphertext from expired shares, forgets finished shares after
// the tombstone period, and clears used tickets.
func (s *Store) Sweep(ctx context.Context, tombstone time.Duration) error {
	now := s.now()
	res, err := s.db.ExecContext(ctx, `UPDATE shares SET status = ?, ciphertext = NULL,
		finished_at = expires_at WHERE status = ? AND expires_at <= ?`,
		StatusExpired, StatusActive, now.UnixMilli())
	if err != nil {
		return err
	}
	s.emit(EventExpired, rowsAffected(res))
	res, err = s.db.ExecContext(ctx, `DELETE FROM shares WHERE finished_at IS NOT NULL AND finished_at <= ?`,
		now.Add(-tombstone).UnixMilli())
	if err != nil {
		return err
	}
	s.emit(EventForgotten, rowsAffected(res))
	_, err = s.db.ExecContext(ctx, `DELETE FROM used_tickets WHERE expires_at <= ?`, now.UnixMilli())
	return err
}

func rowsAffected(res sql.Result) int {
	n, err := res.RowsAffected()
	if err != nil {
		return 0
	}
	return int(n)
}

// ShareCounts returns how many share rows are stored per status.
func (s *Store) ShareCounts(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM shares GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return nil, err
		}
		counts[status] = n
	}
	return counts, rows.Err()
}

// SizeBytes returns the database size (not counting the WAL).
func (s *Store) SizeBytes(ctx context.Context) (int64, error) {
	var size int64
	err := s.db.QueryRowContext(ctx,
		`SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()`).Scan(&size)
	return size, err
}
