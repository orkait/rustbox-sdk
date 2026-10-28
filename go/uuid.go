package rustbox

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strings"
)

const (
	uuidBytes          = 16
	uuidVersionIndex   = 6
	uuidVersionMask    = 0x0f
	uuidVersion4       = 0x40
	uuidVariantIndex   = 8
	uuidVariantMask    = 0x3f
	uuidVariantRFC4122 = 0x80
	uuidSeparator      = "-"
)

var (
	uuidGroups  = []int{4, 2, 2, 2, 6}
	uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

func newUUID() (string, error) {
	b := make([]byte, uuidBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[uuidVersionIndex] = (b[uuidVersionIndex] & uuidVersionMask) | uuidVersion4
	b[uuidVariantIndex] = (b[uuidVariantIndex] & uuidVariantMask) | uuidVariantRFC4122
	parts := make([]string, 0, len(uuidGroups))
	for _, size := range uuidGroups {
		parts = append(parts, hex.EncodeToString(b[:size]))
		b = b[size:]
	}
	return strings.Join(parts, uuidSeparator), nil
}

func isUUID(key string) bool {
	return uuidPattern.MatchString(key)
}
