package chat

import (
	"fmt"
	"strings"

	"github.com/mfahriferdiansyah/anima/backend/internal/llm"
)

// ContextNote is a decrypted memory note the client retrieved from its vault
// and attached to the request. It exists only for the duration of this
// request — the backend keeps nothing.
type ContextNote struct {
	NoteID string   `json:"noteId"`
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Tags   []string `json:"tags,omitempty"`
}

// distillerSystemPrompt extracts durable facts from a conversation turn.
// Notes must be facts about the user or their world — never conversation
// summaries — and an empty result is the normal outcome for chit-chat. Distill
// works on a transcript rather than grounding, so it composes its own prompt
// instead of going through composeSystemPrompt.
const distillerSystemPrompt = `You distill conversations into durable memory notes for a personal companion.

Extract durable FACTS about the user or their world: preferences, people, relationships, events, decisions, plans. Each note must be a self-contained fact that will still be useful weeks from now.

Do NOT:
- summarize the conversation itself
- record small talk, transient moods, or questions
- record anything the assistant said

Respond with STRICT JSON and nothing else, in exactly this shape:
{"notes":[{"title":"short specific title","body":"the fact, in markdown","tags":["lowercase","keywords"],"links":[]}]}

"links" lists related noteIds only when the conversation explicitly referenced an existing note; it is usually empty.

If the conversation contains nothing worth remembering, respond {"notes":[]} — this is common and correct.`

// suggestMessages builds the message pair for a /suggest completion, composed
// through the shared prompt system (identity + grounding + task + contract).
func suggestMessages(name string, notes []ContextNote, canvas []CanvasContext, calendar []CalendarEvent) []llm.Message {
	return []llm.Message{
		{Role: "system", Content: composeSystemPrompt(capSuggest, name, notes, canvas, calendar)},
		{Role: "user", Content: "Propose my next steps now, based on my notes and calendar. Return only the JSON."},
	}
}

// draftMessages builds the message pair for a /draft completion: a full
// prepared note, grounded primarily in the owner's calendar plus related notes
// and canvas.
func draftMessages(name string, notes []ContextNote, canvas []CanvasContext, calendar []CalendarEvent) []llm.Message {
	return []llm.Message{
		{Role: "system", Content: composeSystemPrompt(capDraft, name, notes, canvas, calendar)},
		{Role: "user", Content: "Prepare the note now. Return only the JSON."},
	}
}

func distillMessages(transcript []llm.Message) []llm.Message {
	var b strings.Builder
	b.WriteString("Conversation to distill:\n")
	for _, m := range transcript {
		fmt.Fprintf(&b, "\n%s: %s\n", m.Role, m.Content)
	}
	return []llm.Message{
		{Role: "system", Content: distillerSystemPrompt},
		{Role: "user", Content: b.String()},
	}
}
