package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/blake2b"
)

// ed25519Flag is the Sui signature-scheme flag for ed25519.
//
// v1 supports ed25519-flag wallets ONLY. Other schemes — secp256k1 (0x01),
// secp256r1 (0x02), multisig (0x03), zkLogin (0x05) — are out of scope and
// get a clear error rather than an opaque verification failure. All demo
// accounts use ed25519 wallets.
const ed25519Flag = 0x00

// personalMessageIntent is the Sui intent prefix for personal messages:
// scope=PersonalMessage(3), version=V0(0), app=Sui(0).
var personalMessageIntent = []byte{3, 0, 0}

type verifyRequest struct {
	Address string `json:"address"`
	Nonce   string `json:"nonce"`
	// Signature is the wallet personal-message signature:
	// base64( flag(1) || sig(64) || pubkey(32) ).
	Signature string `json:"signature"`
}

// HandleVerify serves POST /auth/verify: checks nonce freshness, verifies the
// Sui personal-message signature over the nonce bytes, checks the public key
// derives the claimed address, and mints a 24h JWT.
func (s *Service) HandleVerify(w http.ResponseWriter, r *http.Request) {
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Address == "" || req.Nonce == "" || req.Signature == "" {
		http.Error(w, "address, nonce and signature are required", http.StatusBadRequest)
		return
	}
	if err := validateNonce(req.Nonce, time.Now()); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	if err := verifyPersonalMessage(req.Address, []byte(req.Nonce), req.Signature); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	token, err := s.mintToken(normalizeAddress(req.Address))
	if err != nil {
		http.Error(w, "token signing failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"token": token})
}

// verifyPersonalMessage verifies a Sui wallet personal-message signature:
// digest = blake2b-256( intent[3,0,0] || bcs-length-prefixed(message) ),
// ed25519-verify(pubkey, digest, sig), then derived address must equal the
// claimed address: blake2b-256( flag(0x00) || pubkey ).
func verifyPersonalMessage(address string, message []byte, sigB64 string) error {
	raw, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return errors.New("signature is not valid base64")
	}
	if len(raw) != 1+ed25519.SignatureSize+ed25519.PublicKeySize {
		return errors.New("signature must be flag(1) || sig(64) || pubkey(32)")
	}
	if raw[0] != ed25519Flag {
		return fmt.Errorf("unsupported signature scheme 0x%02x: only ed25519 wallets are supported in v1", raw[0])
	}
	sig := raw[1 : 1+ed25519.SignatureSize]
	pub := ed25519.PublicKey(raw[1+ed25519.SignatureSize:])

	if !ed25519.Verify(pub, personalMessageDigest(message), sig) {
		return errors.New("signature verification failed")
	}
	if !addressMatches(address, pub) {
		return errors.New("public key does not match claimed address")
	}
	return nil
}

func personalMessageDigest(message []byte) []byte {
	h, _ := blake2b.New256(nil)
	h.Write(personalMessageIntent)
	h.Write(uleb128(len(message))) // BCS vector<u8> length prefix
	h.Write(message)
	return h.Sum(nil)
}

func addressMatches(claimed string, pub ed25519.PublicKey) bool {
	h, _ := blake2b.New256(nil)
	h.Write([]byte{ed25519Flag})
	h.Write(pub)
	derived := hex.EncodeToString(h.Sum(nil))
	return strings.EqualFold(strings.TrimPrefix(claimed, "0x"), derived)
}

func normalizeAddress(addr string) string {
	addr = strings.ToLower(addr)
	if !strings.HasPrefix(addr, "0x") {
		addr = "0x" + addr
	}
	return addr
}

func uleb128(n int) []byte {
	var out []byte
	for {
		b := byte(n & 0x7f)
		n >>= 7
		if n != 0 {
			out = append(out, b|0x80)
			continue
		}
		return append(out, b)
	}
}
