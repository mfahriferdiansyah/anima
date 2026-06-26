package chat

import (
	"encoding/json"
	"strings"
)

// Structured-output robustness lives here. Every capability that returns JSON
// (distill, suggest, draft) parses through these helpers: strip any markdown
// fence, unmarshal, then validate and normalize the result. A single bad model
// response degrades to an empty/honest value rather than reaching the UI or
// returning a 500 — replacing the prompt-level "do not wrap in code fences"
// plea with an actual safety net.

// stripFences removes a leading ```json / ``` fence and a trailing ``` fence
// from a model response, tolerating the markdown wrappers some models add.
func stripFences(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

// validateNotes drops items with no title (unusable to the client) and
// normalizes nil Tags/Links to empty slices. The returned slice is never nil.
func validateNotes(in []Note) []Note {
	out := make([]Note, 0, len(in))
	for _, n := range in {
		if strings.TrimSpace(n.Title) == "" {
			continue
		}
		if n.Tags == nil {
			n.Tags = []string{}
		}
		if n.Links == nil {
			n.Links = []string{}
		}
		out = append(out, n)
	}
	return out
}

// Draft is a prepared note produced by /draft. When Prepared is false there is
// nothing worth preparing and Reason carries the short explanation; the client
// seals nothing in that case. Reason never doubles as a sealable body.
type Draft struct {
	Prepared bool     `json:"prepared"`
	Title    string   `json:"title"`
	Body     string   `json:"body"`
	Tags     []string `json:"tags"`
	Links    []string `json:"links"`
	Reason   string   `json:"reason,omitempty"`
}

// parseDraft extracts and validates a /draft response. A prepared draft must
// carry a non-empty title and body; a reply that sets prepared:true but leaves
// either empty is demoted to prepared:false so the client never seals an empty
// or near-empty note. The backend owns this near-empty decision (R12).
func parseDraft(raw string) (Draft, bool) {
	var d Draft
	if err := json.Unmarshal([]byte(stripFences(raw)), &d); err != nil {
		return Draft{}, false
	}
	if d.Tags == nil {
		d.Tags = []string{}
	}
	if d.Links == nil {
		d.Links = []string{}
	}
	if d.Prepared && (strings.TrimSpace(d.Title) == "" || strings.TrimSpace(d.Body) == "") {
		return Draft{Prepared: false, Tags: []string{}, Links: []string{}, Reason: "nothing substantial to prepare yet"}, true
	}
	return d, true
}
