package relayclient

import (
	"errors"
	"strings"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

var (
	// ErrClosed is returned once the connection has ended without an Error
	// frame, for example after the relay closed /v1/pair normally.
	ErrClosed = errors.New("relay connection closed")
	// ErrStale means the relay sent nothing for longer than its own idle
	// timeout, so the connection is assumed dead.
	ErrStale = errors.New("relay stopped answering")
	// ErrFlooded means the relay sent more frames than the client had
	// taken with Next, past MaxQueuedFrames.
	ErrFlooded = errors.New("the relay sent more than this client could keep up with")
)

// StatusError is a non-OK Result, or a fatal Error frame from the relay.
type StatusError struct {
	Status  agentpb.Status
	Message string
	// Fatal is true for Error frames, after which the relay closes the
	// connection.
	Fatal bool
}

func (e *StatusError) Error() string {
	name := strings.ToLower(strings.TrimPrefix(e.Status.String(), "STATUS_"))
	if e.Message == "" {
		return "relay: " + strings.ReplaceAll(name, "_", " ")
	}
	// The relay chooses the text; it ends up on terminals and in logs.
	return "relay: " + termsafe.Message(e.Message)
}

// IsStatus reports whether err is a StatusError with the given status.
func IsStatus(err error, status agentpb.Status) bool {
	var se *StatusError
	return errors.As(err, &se) && se.Status == status
}

// ErrTooLarge is returned by Send for an envelope over
// agentproto.MaxEnvelopeSize. It is a non-fatal STATUS_TOO_LARGE StatusError,
// the answer the relay would give, so callers handle both alike.
var ErrTooLarge error = &StatusError{Status: agentpb.Status_STATUS_TOO_LARGE, Message: "the envelope is larger than the relay accepts"}
