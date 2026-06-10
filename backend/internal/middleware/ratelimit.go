package middleware

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/mfahriferdiansyah/anima/backend/internal/auth"
)

// RateLimit applies an in-process token bucket per JWT subject (capacity and
// refill rate of perMin requests per minute). Over-limit requests get 429
// with a Retry-After header. In-process state only — no external store; the
// bucket map is the sole mutable state in the backend and holds no content.
func RateLimit(perMin int) func(http.Handler) http.Handler {
	ratePerSec := float64(perMin) / 60
	var mu sync.Mutex
	buckets := make(map[string]*bucket)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			subject := auth.Subject(r.Context())
			now := time.Now()

			mu.Lock()
			b, ok := buckets[subject]
			if !ok {
				b = &bucket{tokens: float64(perMin), last: now}
				buckets[subject] = b
			} else {
				b.tokens = min(float64(perMin), b.tokens+now.Sub(b.last).Seconds()*ratePerSec)
				b.last = now
			}
			if b.tokens < 1 {
				retryAfter := int(math.Ceil((1 - b.tokens) / ratePerSec))
				mu.Unlock()
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
				return
			}
			b.tokens--
			mu.Unlock()

			next.ServeHTTP(w, r)
		})
	}
}

type bucket struct {
	tokens float64
	last   time.Time
}
