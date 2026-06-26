package chat

// TRUST BOUNDARY: /draft sends the widest grounding bundle — decrypted note
// bodies, serialized canvas, and calendar — to OpenRouter for inference during
// this request. The backend stores nothing — see package doc.

import (
	"encoding/json"
	"net/http"
)

type draftRequest struct {
	Name     string          `json:"name"`
	Context  []ContextNote   `json:"context"`
	Canvas   []CanvasContext `json:"canvas,omitempty"`
	Calendar []CalendarEvent `json:"calendar,omitempty"`
}

// HandleDraft produces a full, structured prepared note for the owner, grounded
// in their calendar plus related notes and canvas. It is stateless — the backend
// stores nothing. The response carries an explicit `prepared` flag: when there
// is nothing worth preparing it returns {"prepared":false,"reason":...} with no
// sealable body, and the client seals nothing. Malformed LLM JSON is retried
// once, then degrades to a not-prepared draft (never a 500). The backend owns
// the near-empty decision so an empty note is never sealed (R12).
func (h *Handler) HandleDraft(w http.ResponseWriter, r *http.Request) {
	var req draftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	msgs := draftMessages(req.Name, req.Context, req.Canvas, req.Calendar)
	raw, err := h.LLM.Complete(r.Context(), h.DefaultModel, msgs)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	draft, ok := parseDraft(raw)
	if !ok {
		// Malformed LLM JSON: retry once, then settle for nothing prepared.
		raw, err = h.LLM.Complete(r.Context(), h.DefaultModel, msgs)
		if err == nil {
			draft, ok = parseDraft(raw)
		}
		if !ok {
			draft = Draft{Prepared: false, Tags: []string{}, Links: []string{}, Reason: "could not prepare a draft just now"}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(draft)
}
