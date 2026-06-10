// Package middleware provides the HTTP middleware for the ANIMA backend:
// request logging, CORS, and per-subject rate limiting.
package middleware

import (
	"log"
	"net/http"
	"time"
)

// RequestLogger logs method, path, status, and latency — NOTHING else.
//
// PRODUCT INVARIANT (custody claim): this backend is a stateless proxy for
// memory that lives client-side. Request bodies, query strings, Authorization
// headers, and message content must NEVER be logged — on any path, including
// error paths. Adding such logging breaks the product's "no logged content"
// custody claim. Handlers must not log at all; this access line is the only
// per-request log output.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach the underlying writer (needed for
// Flush on the SSE chat stream).
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
