package relay

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// store persists what must survive a restart: approvers, their agents,
// retained envelopes and tombstones of revoked agents. The server keeps a
// copy of all of it in memory (it is small: at most one retained envelope
// per sender and recipient) and writes through, so routing never waits on
// the database.
type store struct {
	db *sql.DB
}

type approverRow struct {
	key []byte
	sub string
	dev string
	// Unix milliseconds. Both are zero in token mode, where nothing expires.
	passIssuedAt  int64
	passExpiresAt int64
	agentLimit    int
	createdAt     int64
}

type agentRow struct {
	key           []byte
	approverKey   []byte
	revocationKey []byte
	createdAt     int64
	// lastSeenAt is 0 until the agent first authenticates.
	lastSeenAt int64
}

// authenticated reports whether the agent ever signed in. Until then it may
// be a key nobody holds: it gets a smaller queue and no tombstone.
func (a *agentRow) authenticated() bool { return a.lastSeenAt != 0 }

type retainedRow struct {
	id        int64
	recipient []byte
	sender    []byte
	messageID []byte
	envelope  []byte
	expiresAt int64
}

const schema = `
CREATE TABLE IF NOT EXISTS approvers (
	key BLOB PRIMARY KEY,
	sub TEXT NOT NULL,
	dev TEXT NOT NULL,
	pass_issued_at INTEGER NOT NULL,
	pass_expires_at INTEGER NOT NULL,
	agent_limit INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
	key BLOB PRIMARY KEY,
	approver_key BLOB NOT NULL REFERENCES approvers (key),
	revocation_key BLOB NOT NULL,
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_approver ON agents (approver_key);
CREATE TABLE IF NOT EXISTS retained (
	id INTEGER PRIMARY KEY,
	recipient BLOB NOT NULL,
	sender BLOB NOT NULL,
	message_id BLOB NOT NULL,
	envelope BLOB NOT NULL,
	expires_at INTEGER NOT NULL,
	UNIQUE (recipient, sender),
	UNIQUE (recipient, message_id)
);
CREATE INDEX IF NOT EXISTS retained_expires ON retained (expires_at);
CREATE INDEX IF NOT EXISTS retained_sender ON retained (sender);
CREATE TABLE IF NOT EXISTS revoked_agents (
	key BLOB PRIMARY KEY,
	revoked_at INTEGER NOT NULL,
	approver_key BLOB NOT NULL DEFAULT x''
);
CREATE INDEX IF NOT EXISTS revoked_agents_at ON revoked_agents (revoked_at);
CREATE INDEX IF NOT EXISTS revoked_agents_approver ON revoked_agents (approver_key, revoked_at);
`

// openStore opens (and creates) the SQLite database. Use ":memory:" in tests.
func openStore(path string) (*store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate", path)
	if path == ":memory:" {
		dsn = "file::memory:?_pragma=foreign_keys(1)&_txlock=immediate"
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
	return &store{db: db}, nil
}

func (s *store) close() error { return s.db.Close() }

// dbTimeout bounds every query, because callers hold the server lock.
const dbTimeout = 5 * time.Second

func (s *store) exec(query string, args ...any) error {
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	_, err := s.db.ExecContext(ctx, query, args...)
	return err
}

// inTx runs f in one transaction.
func (s *store) inTx(f func(ctx context.Context, tx *sql.Tx) error) error {
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := f(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

type stmt struct {
	query string
	args  []any
}

func execAll(ctx context.Context, tx *sql.Tx, stmts ...stmt) error {
	for _, st := range stmts {
		if _, err := tx.ExecContext(ctx, st.query, st.args...); err != nil {
			return err
		}
	}
	return nil
}

// queryAll scans every row of query. It closes the rows before returning,
// which matters with a single connection.
func queryAll[T any](ctx context.Context, db *sql.DB, query string, scan func(*sql.Rows, *T) error) ([]T, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []T
	for rows.Next() {
		var v T
		if err := scan(rows, &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// load reads everything the server keeps in memory. Retained envelopes come
// in arrival order.
func (s *store) load() ([]approverRow, []agentRow, []retainedRow, error) {
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	approvers, err := queryAll(ctx, s.db, `SELECT key, sub, dev, pass_issued_at, pass_expires_at,
		agent_limit, created_at FROM approvers`, func(rows *sql.Rows, a *approverRow) error {
		return rows.Scan(&a.key, &a.sub, &a.dev, &a.passIssuedAt, &a.passExpiresAt, &a.agentLimit, &a.createdAt)
	})
	if err != nil {
		return nil, nil, nil, err
	}
	agents, err := queryAll(ctx, s.db, `SELECT key, approver_key, revocation_key, created_at, last_seen_at FROM agents`,
		func(rows *sql.Rows, a *agentRow) error {
			return rows.Scan(&a.key, &a.approverKey, &a.revocationKey, &a.createdAt, &a.lastSeenAt)
		})
	if err != nil {
		return nil, nil, nil, err
	}
	retained, err := queryAll(ctx, s.db, `SELECT id, recipient, sender, message_id, envelope, expires_at
		FROM retained ORDER BY id`, func(rows *sql.Rows, r *retainedRow) error {
		return rows.Scan(&r.id, &r.recipient, &r.sender, &r.messageID, &r.envelope, &r.expiresAt)
	})
	if err != nil {
		return nil, nil, nil, err
	}
	return approvers, agents, retained, nil
}

func (s *store) putApprover(a approverRow) error {
	return s.exec(`INSERT INTO approvers
		(key, sub, dev, pass_issued_at, pass_expires_at, agent_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (key) DO UPDATE SET sub = excluded.sub, dev = excluded.dev,
		pass_issued_at = excluded.pass_issued_at, pass_expires_at = excluded.pass_expires_at,
		agent_limit = excluded.agent_limit`,
		a.key, a.sub, a.dev, a.passIssuedAt, a.passExpiresAt, a.agentLimit, a.createdAt)
}

// putAgent registers an agent, or updates its revocation key, and clears any
// tombstone for the key.
func (s *store) putAgent(a agentRow) error {
	return s.inTx(func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO agents
			(key, approver_key, revocation_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (key) DO UPDATE SET revocation_key = excluded.revocation_key`,
			a.key, a.approverKey, a.revocationKey, a.createdAt, a.lastSeenAt); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM revoked_agents WHERE key = ?`, a.key)
		return err
	})
}

func (s *store) touchAgent(key []byte, at time.Time) error {
	return s.exec(`UPDATE agents SET last_seen_at = ? WHERE key = ?`, at.UnixMilli(), key)
}

// isRevoked reports whether key belongs to an agent removed within the
// tombstone lifetime.
func (s *store) isRevoked(key []byte) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM revoked_agents WHERE key = ?`, key).Scan(&n)
	return n > 0, err
}

// sweepTombstones forgets agents revoked before cutoff.
func (s *store) sweepTombstones(cutoff time.Time) error {
	return s.exec(`DELETE FROM revoked_agents WHERE revoked_at <= ?`, cutoff.UnixMilli())
}

// tombstone records a removed agent for its approver, then drops that
// approver's oldest tombstones beyond keep, so churn can't grow the table
// without bound.
func tombstone(key, approverKey []byte, now time.Time, keep int) []stmt {
	return []stmt{
		{`INSERT INTO revoked_agents (key, approver_key, revoked_at) VALUES (?, ?, ?)
			ON CONFLICT (key) DO UPDATE SET approver_key = excluded.approver_key, revoked_at = excluded.revoked_at`,
			[]any{key, approverKey, now.UnixMilli()}},
		trimTombstones(approverKey, keep),
	}
}

func trimTombstones(approverKey []byte, keep int) stmt {
	return stmt{`DELETE FROM revoked_agents WHERE approver_key = ? AND rowid NOT IN
		(SELECT rowid FROM revoked_agents WHERE approver_key = ? ORDER BY revoked_at DESC, rowid DESC LIMIT ?)`,
		[]any{approverKey, approverKey, keep}}
}

// deleteAgent removes an agent and every retained envelope to or from it.
// An agent that ever authenticated leaves a tombstone, so it learns it was
// revoked; one that never did was never online to miss it.
func (s *store) deleteAgent(ag *agentRow, now time.Time, keepTombstones int) error {
	stmts := []stmt{
		{`DELETE FROM retained WHERE recipient = ? OR sender = ?`, []any{ag.key, ag.key}},
		{`DELETE FROM agents WHERE key = ?`, []any{ag.key}},
	}
	if ag.authenticated() {
		stmts = append(stmts, tombstone(ag.key, ag.approverKey, now, keepTombstones)...)
	}
	return s.inTx(func(ctx context.Context, tx *sql.Tx) error {
		return execAll(ctx, tx, stmts...)
	})
}

// deleteApprover removes an approver with its agents and their envelopes,
// leaving tombstones for the agents that ever authenticated.
func (s *store) deleteApprover(key []byte, now time.Time, keepTombstones int) error {
	const agentsOf = `SELECT key FROM agents WHERE approver_key = ?`
	return s.inTx(func(ctx context.Context, tx *sql.Tx) error {
		return execAll(ctx, tx,
			stmt{`INSERT INTO revoked_agents (key, approver_key, revoked_at)
				SELECT key, approver_key, ? FROM agents WHERE approver_key = ? AND last_seen_at != 0
				ON CONFLICT (key) DO UPDATE SET approver_key = excluded.approver_key, revoked_at = excluded.revoked_at`,
				[]any{now.UnixMilli(), key}},
			trimTombstones(key, keepTombstones),
			stmt{`DELETE FROM retained WHERE recipient IN (` + agentsOf + `) OR sender IN (` + agentsOf + `)`, []any{key, key}},
			stmt{`DELETE FROM retained WHERE recipient = ? OR sender = ?`, []any{key, key}},
			stmt{`DELETE FROM agents WHERE approver_key = ?`, []any{key}},
			stmt{`DELETE FROM approvers WHERE key = ?`, []any{key}},
		)
	})
}

// putRetained stores a retained envelope, replacing an older one from the
// same sender to the same recipient, and returns its row ID.
func (s *store) putRetained(r retainedRow) (id int64, err error) {
	err = s.inTx(func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM retained WHERE recipient = ? AND sender = ?`, r.recipient, r.sender); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO retained (recipient, sender, message_id, envelope, expires_at)
			VALUES (?, ?, ?, ?, ?)`, r.recipient, r.sender, r.messageID, r.envelope, r.expiresAt)
		if err != nil {
			return err
		}
		id, err = res.LastInsertId()
		return err
	})
	return id, err
}

// deleteRetained deletes the row id if it still holds this recipient's
// message. The sweep can delete an expired row before the mailbox lets go
// of it, and SQLite may give its id to a new row, possibly another
// account's; a late Ack of the old envelope must not delete that one.
func (s *store) deleteRetained(id int64, recipient, messageID []byte) error {
	return s.exec(`DELETE FROM retained WHERE id = ? AND recipient = ? AND message_id = ?`, id, recipient, messageID)
}

// sweepRetained deletes retained envelopes past their deadline.
func (s *store) sweepRetained(now time.Time) error {
	return s.exec(`DELETE FROM retained WHERE expires_at <= ?`, now.UnixMilli())
}
