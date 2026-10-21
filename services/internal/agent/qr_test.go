package agent

import (
	"strings"
	"testing"
	"unicode/utf8"

	"rsc.io/qr"
)

func TestRenderQR(t *testing.T) {
	text := "cryptex-pair:" + strings.Repeat("A", 160)
	code, _ := qr.Encode(text, qr.L)
	for _, invert := range []bool{false, true} {
		out, err := RenderQR(text, invert)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSuffix(out, "\n"), "\n")
		size := code.Size + 2*qrQuietZone
		if len(lines) != (size+1)/2 {
			t.Fatalf("%d lines for %d modules", len(lines), size)
		}
		for _, l := range lines {
			if n := utf8.RuneCountInString(l); n != size {
				t.Fatalf("line of %d characters, want %d", n, size)
			}
			if strings.Trim(l, " ▀▄█") != "" {
				t.Fatalf("unexpected characters in %q", l)
			}
		}
		// The quiet zone is light: drawn as blocks normally, blank inverted.
		// Line 2 holds module rows 4 and 5; one module in from the finder
		// pattern's corner, row 4 is dark and row 5 light.
		first, finder := []rune(lines[0]), []rune(lines[2])
		if invert {
			if first[0] != ' ' || finder[qrQuietZone+1] != '▀' {
				t.Errorf("inverted: %q / %q", lines[0], lines[2])
			}
		} else if first[0] != '█' || finder[qrQuietZone+1] != '▄' {
			t.Errorf("normal: %q / %q", lines[0], lines[2])
		}
	}
}
