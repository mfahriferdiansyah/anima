---
name: anima
description: Use the owner's ANIMA memory vault (via the anima-mcp tools) to remember durable facts, recall what the owner knows, and place memories on their canvas. Trigger when the user says "remember this", "what do I know about…", "check my memory/vault", "save this to my vault", or asks about their own past notes, preferences, people, or plans.
---

# ANIMA vault skill

The user owns an ANIMA vault: encrypted markdown memories on Walrus, owned by
their Sui wallet. You have a paired agent key via the `anima` MCP server.
Writes are attributed to you (`author` field) and visible in their app.

> This skill operates the vault. For Anima's product framing: "memory vault" here is the engineering term, not the pitch; Anima is an agentic workspace.

## Tools and when to use them

- `recall(query)` — ALWAYS try this before answering questions about the
  user's life, preferences, people, plans, or past work. Keywords work best
  ("sister wedding", "coffee", "kyoto trip").
- `remember(title, body, tags?)` — when the user says "remember this" or
  shares a durable fact worth keeping (a decision, a preference, a milestone,
  a person). Write FACTS, not conversation summaries. One fact per note.
  Takes 10–20s (real Walrus write) — tell the user it's being stored.
- `list_notes()` — orientation: what exists in the vault.
- `read_note(noteId)` — full markdown of one note.
- `place_note(noteId, x, y)` — position a note on their multiplayer canvas
  (only when the user asks you to organize/arrange their canvas).

## Style rules

- Cite memory you used: mention the note title naturally ("your note about
  Maya's wedding says…").
- Never invent memories. If recall finds nothing, say so.
- Don't store secrets/credentials as notes.
- Errors mentioning "not paired" or "fund" → tell the user to open the ANIMA
  app: agents menu (pairing) or fund the printed agent address (testnet SUI).
