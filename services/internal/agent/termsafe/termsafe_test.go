package termsafe

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestString(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"plain", "Pixel 8", "Pixel 8"},
		{"accents and emoji stay", "Téléphone de Zoë 📱", "Téléphone de Zoë 📱"},
		// OSC 52 sets the clipboard: ESC ] 52 ; c ; base64 BEL.
		{"osc 52", "Pixel\x1b]52;c;ZWNobyBwd25lZA==\x07 8", "Pixel�]52;c;ZWNobyBwd25lZA==� 8"},
		{"osc 52 with st", "a\x1b]52;c;eA==\x1b\\b", "a�]52;c;eA==�\\b"},
		{"csi", "\x1b[2J\x1b[Hfake prompt", "�[2J�[Hfake prompt"},
		{"c1 csi", "a\u009b31mb", "a�31mb"},
		{"newline and tab", "line1\nline2\tx\r", "line1�line2�x�"},
		{"del", "a\x7fb", "a�b"},
		{"bidi override", "Pixel ‮gnp.exe", "Pixel �gnp.exe"},
		{"bidi isolates", "⁦a⁧b⁨c⁩", "�a�b�c�"},
		{"bidi marks", "‎a‏b؜c", "�a�b�c"},
		{"embeddings", "‪a‫b‬c‭d", "�a�b�c�d"},
		{"line separator", "a b c", "a�b�c"},
		{"invalid utf-8", "a\xffb", "a�b"},
	}
	for _, c := range cases {
		if got := String(c.in, 100); got != c.want {
			t.Errorf("%s: String(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

func TestLengthCaps(t *testing.T) {
	long := strings.Repeat("é", 300)
	for _, c := range []struct {
		fn    func(string) string
		limit int
	}{{Name, NameLength}, {Comment, CommentLength}, {Message, MessageLength}} {
		got := c.fn(long)
		if n := utf8.RuneCountInString(got); n != c.limit || !strings.HasSuffix(got, "...") {
			t.Errorf("cap %d: %d characters, %q", c.limit, n, got[len(got)-6:])
		}
		exact := strings.Repeat("x", c.limit)
		if got := c.fn(exact); got != exact {
			t.Errorf("cap %d cut a string of exactly that length", c.limit)
		}
	}
	if got := String("abcdef", 2); got != "..." {
		t.Errorf("tiny cap: %q", got)
	}
}
