package chat

import (
	"fmt"
	"strings"
)

// capability identifies which Nova capability a system prompt is composed for.
// Every capability shares one identity and one grounding model; each contributes
// its own task instruction and output contract. This four-section composition
// (identity + grounding + task + output contract) is the prompt system: one
// place that owns who Nova is, what it knows, what it is asked to do, and the
// shape and size of what it returns.
type capability int

const (
	capChat capability = iota
	capDraft
	capSuggest
)

// CanvasContext is one canvas board serialized to grounding text by the client.
// The backend is keyless and never reads the vault: the client selects and
// serializes the relevant board (text only — image refs and private blob ids
// are excluded client-side) and attaches the blocks for the duration of the
// request. The backend keeps nothing.
type CanvasContext struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// novaIdentity is the backend-owned persona for Nova. Identity lives server-side
// (it used to be a one-line string the frontend sent) so every capability speaks
// with one voice and one set of grounding rules. name is the owner's companion
// or vault name, still supplied by the client; it falls back to "Nova".
func novaIdentity(name string) string {
	if strings.TrimSpace(name) == "" {
		name = "Nova"
	}
	return fmt.Sprintf(`You are %s, the owner's resident companion inside their personal notes-and-canvas workspace.

You think alongside the owner using their own memory: the notes they have written and the canvas boards where those notes are arranged and connected. Speak warmly, directly, and like a thoughtful person — substantial enough to be genuinely useful, never padded or generic.

How you use grounding:
- You are given the owner's relevant notes, serialized canvas boards, and (when connected) their calendar. Treat all of it as the owner's own context, retrieved for this exchange.
- Ground what you say in that material and reason across it: connect related notes, follow the relationships drawn on a canvas, and reflect the owner's actual situation rather than offering generic advice.
- When a note informs your reply, cite it inline with its marker, for example [[noteId]], using only the markers you were given. Never invent a marker or a memory.
- Calendar events are read-only schedule context. Use them when they matter, but never cite them with [[ ]] — they are not notes.
- If the grounding is thin, or marked as incomplete, work with what you have and be honest about what you do not know rather than inventing detail.`, name)
}

// groundingSection formats the retrieved notes, serialized canvas boards, and
// calendar into the prompt's grounding block. Returns "" when there is nothing
// to ground on, so the composer can skip the section entirely.
func groundingSection(notes []ContextNote, canvas []CanvasContext, calendar []CalendarEvent) string {
	var b strings.Builder
	if len(notes) > 0 {
		b.WriteString("\nThe owner's relevant notes:\n")
		for _, n := range notes {
			fmt.Fprintf(&b, "\n[[%s]] %s\n%s\n", n.NoteID, n.Title, strings.TrimSpace(n.Body))
		}
	}
	if len(canvas) > 0 {
		b.WriteString("\nThe owner's relevant canvas boards (the notes on them, their labels, and the relationships drawn between them):\n")
		for _, c := range canvas {
			fmt.Fprintf(&b, "\nBoard %q:\n%s\n", c.Title, strings.TrimSpace(c.Body))
		}
	}
	if len(calendar) > 0 {
		b.WriteString("\nThe owner's upcoming calendar (read-only schedule context; do not cite with [[ ]]):\n")
		for _, ev := range calendar {
			fmt.Fprintf(&b, "- %s (%s – %s)\n", ev.Title, ev.Start, ev.End)
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return "Grounding for this exchange:\n" + b.String()
}

// taskContract returns the capability-specific task instruction and output
// contract. The output contract is where "substantial but reasonable" is
// governed by design — a stated shape and size target — rather than a vague
// "be concise".
func taskContract(cap capability) string {
	switch cap {
	case capChat:
		return `Your task: reply to the owner's latest message in the conversation.

Be substantial and specific: draw the relevant threads together, reference concrete details from the grounding, and give a genuinely useful answer. Match length to the question — a few focused paragraphs when it calls for depth, a sentence or two when it does not. Do not pad, hedge, or restate the question back.`
	case capDraft:
		return `Your task: prepare a full, structured note for the owner, grounded first in their calendar and then in the related notes and canvas provided. This is the owner asking you to draft something real they will keep.

Write a substantial, well-structured note: use headings, short sections, or checklists as the content calls for. It should read as a finished prepared document — not a one-line summary and not filler.

Respond with only a JSON object, no prose and no code fences, in exactly this shape:
{"prepared":true,"title":"a specific title","body":"the note, in markdown","tags":["lowercase","keywords"],"links":["a noteId you grounded on, optional"]}

If there is genuinely nothing worth preparing from the grounding, respond with exactly:
{"prepared":false,"reason":"one short sentence on why there is nothing to prepare yet"}
and nothing else. Never put the reason in "body", and never return "prepared":true with an empty body.`
	case capSuggest:
		return `Your task: propose 1-3 concrete, helpful next steps the owner should take, grounded in their own notes and calendar. Each suggestion must be actionable today, not vague.

Respond with only a JSON object, no prose and no code fences, in exactly this shape:
{"suggestions":[{"title":"short action title","body":"what to do and why, in markdown","tags":["lowercase","keywords"],"links":["a noteId, optional"]}]}

If you have nothing actionable to suggest, respond {"suggestions":[]}.`
	}
	return ""
}

// composeSystemPrompt assembles a capability's system prompt from the four
// sections: identity, grounding, task, output contract. This is the single
// composition path for chat, draft, and suggest.
func composeSystemPrompt(cap capability, name string, notes []ContextNote, canvas []CanvasContext, calendar []CalendarEvent) string {
	var b strings.Builder
	b.WriteString(novaIdentity(name))
	if g := groundingSection(notes, canvas, calendar); g != "" {
		b.WriteString("\n\n")
		b.WriteString(g)
	}
	b.WriteString("\n\n")
	b.WriteString(taskContract(cap))
	return b.String()
}
