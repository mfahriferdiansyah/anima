package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const allowedOrigin = "https://anima.example"

func corsRequest(method, origin, requestMethod string) *httptest.ResponseRecorder {
	handler := CORS([]string{allowedOrigin})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	req := httptest.NewRequest(method, "/chat", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if requestMethod != "" {
		req.Header.Set("Access-Control-Request-Method", requestMethod)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestCORS_PreflightAllowedOrigin(t *testing.T) {
	rec := corsRequest(http.MethodOptions, allowedOrigin, http.MethodPost)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != allowedOrigin {
		t.Fatalf("Allow-Origin = %q, want %q", got, allowedOrigin)
	}
	if rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatal("missing Access-Control-Allow-Methods")
	}
}

func TestCORS_PreflightUnlistedOriginRejected(t *testing.T) {
	rec := corsRequest(http.MethodOptions, "https://evil.example", http.MethodPost)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unlisted origin must not receive Allow-Origin")
	}
}

func TestCORS_RequestUnlistedOriginGetsNoHeaders(t *testing.T) {
	rec := corsRequest(http.MethodGet, "https://evil.example", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200 pass-through", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unlisted origin must not receive Allow-Origin")
	}
}

func TestCORS_RequestAllowedOriginGetsExactHeader(t *testing.T) {
	rec := corsRequest(http.MethodGet, allowedOrigin, "")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != allowedOrigin {
		t.Fatalf("Allow-Origin = %q, want exact %q (no wildcard)", got, allowedOrigin)
	}
}
