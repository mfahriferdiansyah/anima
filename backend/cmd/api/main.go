// Command api is the ANIMA backend: a stateless LLM proxy. No database, no
// session store, no logged content — statelessness is the product's custody
// claim. Kill this server and the user's vault survives untouched.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mfahriferdiansyah/anima/backend/internal/auth"
	"github.com/mfahriferdiansyah/anima/backend/internal/chat"
	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
	"github.com/mfahriferdiansyah/anima/backend/internal/middleware"
	"github.com/mfahriferdiansyah/anima/backend/internal/presence"
)

type config struct {
	port            string
	openRouterKey   string
	openRouterBase  string
	jwtSecret       string
	allowedOrigins  []string
	rateLimitPerMin int
	defaultModel    string
}

func loadConfig() (config, error) {
	cfg := config{
		port:           envOr("PORT", "8080"),
		openRouterKey:  os.Getenv("OPENROUTER_API_KEY"),
		openRouterBase: envOr("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
		jwtSecret:      os.Getenv("JWT_SECRET"),
		defaultModel:   envOr("DEFAULT_MODEL", "anthropic/claude-sonnet-4.5"),
	}
	if cfg.openRouterKey == "" {
		return cfg, errors.New("OPENROUTER_API_KEY is required")
	}
	if cfg.jwtSecret == "" {
		return cfg, errors.New("JWT_SECRET is required")
	}
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			cfg.allowedOrigins = append(cfg.allowedOrigins, origin)
		}
	}
	limit, err := strconv.Atoi(envOr("RATE_LIMIT_PER_MIN", "30"))
	if err != nil || limit < 1 {
		return cfg, errors.New("RATE_LIMIT_PER_MIN must be a positive integer")
	}
	cfg.rateLimitPerMin = limit
	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	authSvc := &auth.Service{Secret: []byte(cfg.jwtSecret)}
	chatHandler := &chat.Handler{
		LLM:          llm.New(cfg.openRouterKey, cfg.openRouterBase),
		DefaultModel: cfg.defaultModel,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestLogger)
	r.Use(middleware.CORS(cfg.allowedOrigins))

	r.Get("/auth/nonce", authSvc.HandleNonce)
	r.Post("/auth/verify", authSvc.HandleVerify)

	// ephemeral multiplayer-canvas relay — zero persistence (custody invariant)
	r.Get("/presence", presence.NewHub().ServeHTTP)

	r.Group(func(r chi.Router) {
		r.Use(authSvc.Middleware)
		r.Use(middleware.RateLimit(cfg.rateLimitPerMin))
		r.Post("/chat", chatHandler.HandleChat)
		r.Post("/distill", chatHandler.HandleDistill)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: /chat holds long-lived SSE streams.
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("listening on :%s", cfg.port)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		log.Fatalf("server: %v", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		fmt.Fprintf(os.Stderr, "shutdown: %v\n", err)
		os.Exit(1)
	}
	log.Println("shutdown complete")
}
