package chat

import (
	"encoding/json"
	"net/http"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

// Note is a distilled memory candidate. The client encrypts and persists it;
// the backend returns it and forgets it.
type Note struct {
	Title string   `json:"title"`
	Body  string   `json:"body"`
	Tags  []string `json:"tags"`
	Links []string `json:"links"`
}

type distillRequest struct {
	Transcript []llm.Message `json:"transcript"`
}

// HandleDistill turns a conversation transcript into durable note candidates.
// An empty notes array is a normal outcome for chit-chat. Malformed LLM JSON
// is retried once, then degrades to an empty array.
func (h *Handler) HandleDistill(w http.ResponseWriter, r *http.Request) {
	var req distillRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Transcript) == 0 {
		http.Error(w, "transcript must not be empty", http.StatusBadRequest)
		return
	}

	msgs := distillMessages(req.Transcript)
	raw, err := h.LLM.Complete(r.Context(), h.DefaultModel, msgs)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	notes, ok := parseNotes(raw)
	if !ok {
		// Malformed LLM JSON: retry once, then settle for no notes.
		raw, err = h.LLM.Complete(r.Context(), h.DefaultModel, msgs)
		if err == nil {
			notes, ok = parseNotes(raw)
		}
		if !ok {
			notes = []Note{}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]Note{"notes": notes})
}

// parseNotes extracts and validates the {"notes":[...]} object from an LLM
// response (see validate.go for fence-stripping and note validation).
func parseNotes(raw string) ([]Note, bool) {
	var out struct {
		Notes []Note `json:"notes"`
	}
	if err := json.Unmarshal([]byte(stripFences(raw)), &out); err != nil {
		return nil, false
	}
	return validateNotes(out.Notes), true
}
