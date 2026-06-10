// Package auth implements stateless wallet authentication: a timestamped
// nonce signed by the user's Sui wallet (personal message) is exchanged for a
// short-lived JWT. No nonce store, no session store — statelessness is the
// product's custody claim.
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	noncePrefix = "anima"
	// nonceWindow bounds the replay window. The nonce carries its own issue
	// timestamp, so freshness is verifiable without storing anything.
	nonceWindow = 60 * time.Second
)

// Service holds the JWT signing secret and serves the auth endpoints.
type Service struct {
	Secret []byte
}

// HandleNonce serves GET /auth/nonce. The nonce is self-describing
// ("anima:<unix-ms>:<rand-hex>") so verification needs no server state.
func (s *Service) HandleNonce(w http.ResponseWriter, r *http.Request) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		http.Error(w, "nonce generation failed", http.StatusInternalServerError)
		return
	}
	nonce := fmt.Sprintf("%s:%d:%s", noncePrefix, time.Now().UnixMilli(), hex.EncodeToString(b[:]))
	writeJSON(w, map[string]string{"nonce": nonce})
}

func validateNonce(nonce string, now time.Time) error {
	parts := strings.Split(nonce, ":")
	if len(parts) != 3 || parts[0] != noncePrefix || parts[2] == "" {
		return errors.New("malformed nonce")
	}
	ms, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return errors.New("malformed nonce timestamp")
	}
	issued := time.UnixMilli(ms)
	if issued.After(now) {
		return errors.New("nonce timestamp is in the future")
	}
	if now.Sub(issued) > nonceWindow {
		return errors.New("nonce expired")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
