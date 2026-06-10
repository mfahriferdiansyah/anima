package auth

import (
	"context"
	"net/http"
	"strings"
)

type subjectKey struct{}

// WithSubject stores the authenticated wallet address on the context.
func WithSubject(ctx context.Context, subject string) context.Context {
	return context.WithValue(ctx, subjectKey{}, subject)
}

// Subject returns the authenticated wallet address, or "" if unauthenticated.
func Subject(ctx context.Context) string {
	subject, _ := ctx.Value(subjectKey{}).(string)
	return subject
}

// Middleware rejects requests without a valid Bearer JWT and stores the
// token subject on the request context.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		subject, err := s.parseToken(token)
		if err != nil {
			http.Error(w, "invalid or expired token", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithSubject(r.Context(), subject)))
	})
}
