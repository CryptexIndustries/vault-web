// Package termsafe makes text that came from the relay or the approver safe
// to print to a terminal or a log. Such text could carry escape sequences
// (OSC 52 writes the clipboard, others retitle the window or hide output) or
// bidi controls that make a name read differently from what it is.
package termsafe

import "unicode/utf8"

const (
	// NameLength caps approver and agent names and hostnames.
	NameLength = 64
	// CommentLength caps SSH key comments.
	CommentLength = 100
	// MessageLength caps relay error messages and similar one-liners.
	MessageLength = 200

	replacement = '�'
	ellipsis    = "..."
)

// unsafe reports whether r must not reach a terminal as is: C0 and C1
// controls, DEL, the bidi embedding, override and isolate controls and
// marks, and the Unicode line and paragraph separators.
func unsafe(r rune) bool {
	switch {
	case r < 0x20, r == 0x7f, r >= 0x80 && r <= 0x9f:
		return true
	case r >= 0x202a && r <= 0x202e, r >= 0x2066 && r <= 0x2069:
		return true
	case r == 0x200e, r == 0x200f, r == 0x061c, r == 0x2028, r == 0x2029:
		return true
	}
	return false
}

// String replaces unsafe characters and invalid UTF-8 with U+FFFD and cuts
// the result to limit characters, ending in "..." when cut.
func String(s string, limit int) string {
	out := make([]rune, 0, min(len(s), limit))
	for _, r := range s {
		if len(out) == limit {
			return string(out[:max(0, limit-len(ellipsis))]) + ellipsis
		}
		if r == utf8.RuneError || unsafe(r) {
			r = replacement
		}
		out = append(out, r)
	}
	return string(out)
}

// Name is String for names and hostnames.
func Name(s string) string { return String(s, NameLength) }

// Comment is String for SSH key comments.
func Comment(s string) string { return String(s, CommentLength) }

// Message is String for messages such as a relay's error text.
func Message(s string) string { return String(s, MessageLength) }
