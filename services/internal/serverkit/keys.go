package serverkit

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

// ParseMLDSA65Keys reads "kid:base64,kid2:base64", the form the backend
// publishes its ticket and relay pass signing keys in. Several keys let a
// rotation overlap.
func ParseMLDSA65Keys(raw string) (map[string]*mldsa65.PublicKey, error) {
	keys := map[string]*mldsa65.PublicKey{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		kid, encoded, ok := strings.Cut(entry, ":")
		if !ok || kid == "" {
			return nil, fmt.Errorf("key %q: want <kid>:<base64>", entry)
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("key %q: %w", kid, err)
		}
		var pk mldsa65.PublicKey
		if err := pk.UnmarshalBinary(raw); err != nil {
			return nil, fmt.Errorf("key %q: %w", kid, err)
		}
		keys[kid] = &pk
	}
	if len(keys) == 0 {
		return nil, errors.New("no keys configured")
	}
	return keys, nil
}
