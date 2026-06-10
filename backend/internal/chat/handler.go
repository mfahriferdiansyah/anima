// Package chat serves the LLM endpoints: streaming persona chat and the
// note distiller. Both are pass-through — the backend sees chat context
// transiently during inference and stores nothing.
//
// LOG DISCIPLINE (custody invariant): handlers in this package never log.
// Request bodies, transcripts, persona blocks, and context notes must not
// appear in logs on any path, including errors. See middleware.RequestLogger.
package chat

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

// Handler serves POST /chat and POST /distill.
type Handler struct {
	LLM          *llm.Client
	DefaultModel string
}

type chatRequest struct {
	Model      string        `json:"model,omitempty"`
	Persona    string        `json:"persona"`
	Transcript []llm.Message `json:"transcript"`
	Context    []ContextNote `json:"context"`
}

// HandleChat streams a persona completion as SSE: one unnamed event with
// {"delta":...} per content delta, then "event: done" — or "event: error"
// with {"error":...} on upstream failure. Client disconnect cancels the
// upstream request via the request context.
func (h *Handler) HandleChat(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Transcript) == 0 {
		http.Error(w, "transcript must not be empty", http.StatusBadRequest)
		return
	}
	model := req.Model
	if model == "" {
		model = h.DefaultModel
	}

	msgs := make([]llm.Message, 0, len(req.Transcript)+1)
	msgs = append(msgs, llm.Message{Role: "system", Content: chatSystemPrompt(req.Persona, req.Context)})
	msgs = append(msgs, req.Transcript...)

	chunks, err := h.LLM.StreamChat(r.Context(), model, msgs)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	rc.Flush()

	for chunk := range chunks {
		switch {
		case chunk.Err != nil:
			writeEvent(w, "error", map[string]string{"error": chunk.Err.Error()})
			rc.Flush()
			return
		case chunk.Done:
			writeEvent(w, "done", map[string]string{})
			rc.Flush()
			return
		default:
			payload, _ := json.Marshal(map[string]string{"delta": chunk.Delta})
			fmt.Fprintf(w, "data: %s\n\n", payload)
			rc.Flush()
		}
	}
	// Channel closed without a terminal chunk: the client went away and the
	// context cancelled the upstream stream. Nothing left to write.
}

func writeEvent(w http.ResponseWriter, event string, data any) {
	payload, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
}
