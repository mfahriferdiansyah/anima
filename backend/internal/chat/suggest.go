package chat

// TRUST BOUNDARY: decrypted note bodies cross to OpenRouter for inference
// during this request. The backend stores nothing — see package doc.

import (
	"encoding/json"
	"net/http"
	"strings"
)

// CalendarEvent is an optional calendar entry the client may attach to a
// suggest request. It is included in context so Nova can propose timely,
// calendar-grounded next steps. Empty/absent in v1 is fine.
type CalendarEvent struct {
	Title string `json:"title"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type suggestRequest struct {
	Name     string          `json:"name"`
	Context  []ContextNote   `json:"context"`
	Canvas   []CanvasContext `json:"canvas,omitempty"`
	Calendar []CalendarEvent `json:"calendar,omitempty"`
}

// HandleSuggest generates context-aware next-step suggestions for the owner's
// vault. It is stateless — the backend stores nothing and the suggestions are
// returned as ephemeral candidates. Malformed LLM JSON is retried once, then
// degrades to an empty array (never a 500). The client decides which, if any,
// to accept as a real sealed note.
func (h *Handler) HandleSuggest(w http.ResponseWriter, r *http.Request) {
	var req suggestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	msgs := suggestMessages(req.Name, req.Context, req.Canvas, req.Calendar)
	raw, err := h.LLM.Complete(r.Context(), h.DefaultModel, msgs)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	suggestions, ok := parseSuggestions(raw)
	if !ok {
		// Malformed LLM JSON: retry once, then settle for no suggestions.
		raw, err = h.LLM.Complete(r.Context(), h.DefaultModel, msgs)
		if err == nil {
			suggestions, ok = parseSuggestions(raw)
		}
		if !ok {
			suggestions = []Note{}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]Note{"suggestions": suggestions})
}

// parseSuggestions extracts the {"suggestions":[...]} object from an LLM
// response, tolerating markdown code fences around the JSON. The Note type
// is reused — title/body/tags/links match the suggestion shape exactly.
func parseSuggestions(raw string) ([]Note, bool) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)

	var out struct {
		Suggestions []Note `json:"suggestions"`
	}
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, false
	}
	if out.Suggestions == nil {
		out.Suggestions = []Note{}
	}
	for i := range out.Suggestions {
		if out.Suggestions[i].Tags == nil {
			out.Suggestions[i].Tags = []string{}
		}
		if out.Suggestions[i].Links == nil {
			out.Suggestions[i].Links = []string{}
		}
	}
	return out.Suggestions, true
}
