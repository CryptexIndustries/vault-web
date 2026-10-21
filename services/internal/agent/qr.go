package agent

import (
	"strings"

	"rsc.io/qr"
)

const qrQuietZone = 4

// RenderQR draws text as a QR code with half-block characters, two module
// rows per line, like `qrencode -t UTF8`. Light modules are drawn as blocks
// so the code scans on the usual dark terminal; invert draws dark modules
// instead, for light themes.
func RenderQR(text string, invert bool) (string, error) {
	code, err := qr.Encode(text, qr.L)
	if err != nil {
		return "", err
	}
	size := code.Size + 2*qrQuietZone
	// filled reports whether module (x, y), counted from the outer edge of
	// the quiet zone, gets ink.
	filled := func(x, y int) bool {
		x, y = x-qrQuietZone, y-qrQuietZone
		dark := code.Black(x, y) // false outside the code, so the quiet zone is light
		return dark == invert
	}
	var b strings.Builder
	for y := 0; y < size; y += 2 {
		for x := 0; x < size; x++ {
			top := filled(x, y)
			// Sizes are odd, so the last line has only an upper row.
			bottom := y+1 < size && filled(x, y+1)
			switch {
			case top && bottom:
				b.WriteRune('█')
			case top:
				b.WriteRune('▀')
			case bottom:
				b.WriteRune('▄')
			default:
				b.WriteRune(' ')
			}
		}
		b.WriteByte('\n')
	}
	return b.String(), nil
}
