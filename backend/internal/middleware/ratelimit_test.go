package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/mfahriferdiansyah/anima/backend/internal/auth"
)

func limitedRequest(handler http.Handler, subject string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/chat", nil)
	req = req.WithContext(auth.WithSubject(req.Context(), subject))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestRateLimit_31stRequestRejected(t *testing.T) {
	handler := RateLimit(30)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	for i := 1; i <= 30; i++ {
		if rec := limitedRequest(handler, "0xabc"); rec.Code != http.StatusOK {
			t.Fatalf("request %d: status %d, want 200", i, rec.Code)
		}
	}

	rec := limitedRequest(handler, "0xabc")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("31st request: status %d, want 429", rec.Code)
	}
	retryAfter, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || retryAfter < 1 {
		t.Fatalf("Retry-After = %q, want a positive integer", rec.Header().Get("Retry-After"))
	}

	// Another subject has its own bucket.
	if rec := limitedRequest(handler, "0xdef"); rec.Code != http.StatusOK {
		t.Fatalf("other subject: status %d, want 200", rec.Code)
	}
}
