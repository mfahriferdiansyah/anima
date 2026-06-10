package auth

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/blake2b"
)

// wallet simulates an ed25519 Sui wallet for tests.
type wallet struct {
	priv    ed25519.PrivateKey
	address string
}

func newWallet(t *testing.T) wallet {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	h, _ := blake2b.New256(nil)
	h.Write([]byte{0x00})
	h.Write(pub)
	return wallet{priv: priv, address: "0x" + hex.EncodeToString(h.Sum(nil))}
}

// signPersonalMessage produces the wallet personal-message signature format:
// base64( flag(1) || sig(64) || pubkey(32) ) over
// blake2b-256( intent[3,0,0] || bcs(message) ).
func (w wallet) signPersonalMessage(msg []byte) string {
	signing := append([]byte{3, 0, 0}, byte(len(msg)))
	signing = append(signing, msg...)
	digest := blake2b.Sum256(signing)
	sig := ed25519.Sign(w.priv, digest[:])

	out := append([]byte{0x00}, sig...)
	out = append(out, w.priv.Public().(ed25519.PublicKey)...)
	return base64.StdEncoding.EncodeToString(out)
}

func testService() *Service {
	return &Service{Secret: []byte("test-secret")}
}

func freshNonce(t *testing.T, s *Service) string {
	t.Helper()
	rec := httptest.NewRecorder()
	s.HandleNonce(rec, httptest.NewRequest(http.MethodGet, "/auth/nonce", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("nonce: status %d", rec.Code)
	}
	var body struct {
		Nonce string `json:"nonce"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Nonce
}

func postVerify(t *testing.T, s *Service, address, nonce, signature string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"address": address, "nonce": nonce, "signature": signature})
	rec := httptest.NewRecorder()
	s.HandleVerify(rec, httptest.NewRequest(http.MethodPost, "/auth/verify", bytes.NewReader(body)))
	return rec
}

func TestNonceFormat(t *testing.T) {
	nonce := freshNonce(t, testService())
	parts := strings.Split(nonce, ":")
	if len(parts) != 3 || parts[0] != "anima" {
		t.Fatalf("unexpected nonce format: %q", nonce)
	}
	if len(parts[2]) != 32 {
		t.Fatalf("expected 32 hex chars of randomness, got %q", parts[2])
	}
}

func TestVerify_ValidSignature(t *testing.T) {
	s := testService()
	w := newWallet(t)
	nonce := freshNonce(t, s)

	rec := postVerify(t, s, w.address, nonce, w.signPersonalMessage([]byte(nonce)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	subject, err := s.parseToken(body.Token)
	if err != nil {
		t.Fatalf("parseToken: %v", err)
	}
	if subject != w.address {
		t.Fatalf("subject = %q, want %q", subject, w.address)
	}
}

func TestVerify_ExpiredNonce(t *testing.T) {
	s := testService()
	w := newWallet(t)
	nonce := fmt.Sprintf("anima:%d:%s", time.Now().Add(-2*time.Minute).UnixMilli(), strings.Repeat("ab", 16))

	rec := postVerify(t, s, w.address, nonce, w.signPersonalMessage([]byte(nonce)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "expired") {
		t.Fatalf("expected expiry error, got %q", rec.Body.String())
	}
}

func TestVerify_FutureNonce(t *testing.T) {
	s := testService()
	w := newWallet(t)
	nonce := fmt.Sprintf("anima:%d:%s", time.Now().Add(5*time.Minute).UnixMilli(), strings.Repeat("ab", 16))

	rec := postVerify(t, s, w.address, nonce, w.signPersonalMessage([]byte(nonce)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "future") {
		t.Fatalf("expected future-timestamp error, got %q", rec.Body.String())
	}
}

func TestVerify_BadSignature(t *testing.T) {
	s := testService()
	w := newWallet(t)
	nonce := freshNonce(t, s)

	raw, _ := base64.StdEncoding.DecodeString(w.signPersonalMessage([]byte(nonce)))
	raw[10] ^= 0xff // corrupt the signature bytes
	rec := postVerify(t, s, w.address, nonce, base64.StdEncoding.EncodeToString(raw))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
}

func TestVerify_NonEd25519FlagRejected(t *testing.T) {
	s := testService()
	w := newWallet(t)
	nonce := freshNonce(t, s)

	raw, _ := base64.StdEncoding.DecodeString(w.signPersonalMessage([]byte(nonce)))
	raw[0] = 0x01 // secp256k1 flag
	rec := postVerify(t, s, w.address, nonce, base64.StdEncoding.EncodeToString(raw))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ed25519") {
		t.Fatalf("expected clear ed25519-only error, got %q", rec.Body.String())
	}
}

func TestVerify_AddressMismatch(t *testing.T) {
	s := testService()
	signer, other := newWallet(t), newWallet(t)
	nonce := freshNonce(t, s)

	rec := postVerify(t, s, other.address, nonce, signer.signPersonalMessage([]byte(nonce)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
}

func TestMiddleware(t *testing.T) {
	s := testService()
	var gotSubject string
	protected := s.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSubject = Subject(r.Context())
	}))

	t.Run("missing token", func(t *testing.T) {
		rec := httptest.NewRecorder()
		protected.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/chat", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status %d, want 401", rec.Code)
		}
	})

	t.Run("expired token", func(t *testing.T) {
		expired := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
			Subject:   "0xabc",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
		})
		token, err := expired.SignedString(s.Secret)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/chat", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		protected.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status %d, want 401", rec.Code)
		}
	})

	t.Run("valid token", func(t *testing.T) {
		token, err := s.mintToken("0xabc")
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/chat", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		protected.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d, want 200", rec.Code)
		}
		if gotSubject != "0xabc" {
			t.Fatalf("subject = %q, want 0xabc", gotSubject)
		}
	})
}
