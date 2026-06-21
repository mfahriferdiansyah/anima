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

// chatSystemPrompt assembles the system prompt from the persona block and the
// retrieved context notes, instructing the model to cite notes with
// [[noteId]] markers so the client can render citation chips.
func chatSystemPrompt(persona string, notes []ContextNote) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(persona))
	if len(notes) == 0 {
		return b.String()
	}
	b.WriteString("\n\nYou have a long-term memory vault. These memories were retrieved as relevant to the current conversation:\n")
	for _, n := range notes {
		fmt.Fprintf(&b, "\n[[%s]] %s\n%s\n", n.NoteID, n.Title, strings.TrimSpace(n.Body))
	}
	b.WriteString("\nWhen a memory informs your reply, cite it inline with its marker, e.g. [[")
	b.WriteString(notes[0].NoteID)
	b.WriteString("]]. Only cite memories listed above; never invent markers.")
	return b.String()
}

// distillerSystemPrompt extracts durable facts from a conversation turn.
// Notes must be facts about the user or their world — never conversation
// summaries — and an empty result is the normal outcome for chit-chat.
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

// suggestSystemPrompt assembles the system prompt for /suggest: act as the
// persona, read the vault context (and optional calendar), and propose 1-3
// concrete next-step suggestions as {"suggestions":[{title,body,tags,links}]}.
func suggestSystemPrompt(persona string, notes []ContextNote, calendar []CalendarEvent) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(persona))
	b.WriteString("\n\nYour task is to propose 1-3 concrete, helpful NEXT STEPS the owner should take, grounded in their own notes and calendar. Each suggestion must be actionable today, not vague.")
	if len(notes) > 0 {
		b.WriteString("\n\nVault context (notes the owner retrieved as relevant):\n")
		for _, n := range notes {
			fmt.Fprintf(&b, "\n[[%s]] %s\n%s\n", n.NoteID, n.Title, strings.TrimSpace(n.Body))
		}
	}
	if len(calendar) > 0 {
		b.WriteString("\n\nUpcoming calendar events:\n")
		for _, ev := range calendar {
			fmt.Fprintf(&b, "- %s (%s – %s)\n", ev.Title, ev.Start, ev.End)
		}
	}
	b.WriteString("\n\nRespond with STRICT JSON and nothing else, in exactly this shape:\n")
	b.WriteString(`{"suggestions":[{"title":"short action title","body":"what to do and why, in markdown","tags":["lowercase","keywords"],"links":[]}]}`)
	b.WriteString("\n\nDo NOT wrap in code fences. If you have nothing actionable to suggest, respond {\"suggestions\":[]}.")
	return b.String()
}

// suggestMessages builds the message pair for a /suggest completion.
func suggestMessages(persona string, notes []ContextNote, calendar []CalendarEvent) []llm.Message {
	return []llm.Message{
		{Role: "system", Content: suggestSystemPrompt(persona, notes, calendar)},
		{Role: "user", Content: "Propose 1-3 concrete, helpful next-step suggestions based on my vault and calendar. Return only the JSON."},
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
