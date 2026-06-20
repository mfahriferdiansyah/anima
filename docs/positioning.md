# Anima — Positioning & Direction (canonical)

Set 2026-06-19. This is the single source of truth for brand/narrative.
It supersedes the "Obsidian-style memory vault for AI agents" framing in the
repo README (`../README.md`) for positioning purposes. Build facts are
unchanged and authoritative in `status-briefing.md`.

## Audience & horizon

**Submission-first.** Every brand choice optimizes for the Walrus-track judge:
the chain primitive is load-bearing, it is a working system, it demos in five
minutes. The proactive-assistant and integrations vision is the
post-hackathon roadmap, honored as direction, never claimed as shipped.

## Category

Anima is an **agentic workspace**: one place for your notes and canvas where
people and AI agents work the same board.

> Frame, not the headline. "Agentic workspace" on its own is Taskade's exact
> category and tests as a comprehension wall with real readers. Use it to say
> what KIND of product this is (subhead, judge pitch, docs). Keep concrete,
> comprehension-tested words in the H1.

## The differentiator (the moat)

As of May 2026 both Notion ("any data, any tool, any agent") and Taskade
("projects remember, agents think") do agents-in-your-workspace. Interop alone
is no longer ours. What they leave open, and what we own:

**Your own agents, on data you own, that survives the app.**

- Your own external agents (the Claude Code / Cursor you already pay for) are
  first-class collaborators, not a platform's pre-approved bots.
- Humans and agents are live on the same board, each a visible cursor, every
  edit signed (name + rev).
- The data is wallet-owned and Seal-sealed on Walrus, so it outlives any app,
  including ours. Not replicable on "your data on our servers."

This is also the answer to "why does this need a chain": custody and survival,
which a Postgres + S3 SaaS cannot structurally promise.

## Lead copy

Brand voice: sentence case, lowercase "ai", no em dashes, the ✦ mark is
brand-only (agent cursors use the hollow star, never ✦).

- Headline (kept, comprehension-tested 10/10 on the word "notes"):
  **Notes on a shared canvas.**
- Tier-2 (the wedge):
  **Your own ai tools read and write them too. claude code, codex, a
  teammate's agent, or any of yours.**
- Category line (subhead):
  one agentic workspace, notes like a page or a canvas like excalidraw, where
  people and agents work the same board, each with their own cursor.
- Ownership line:
  you bring the ai. anima is the shared notes it reads and writes, sealed to
  storage you own.
- One-liner (for docs / judges):
  Anima is an agentic workspace where your own AI agents and your team read and
  write the same notes and canvas, sealed to storage you own, so it survives
  any app.

## Supporting beats (order)

1. Your own agents read and write your notes (the wedge, loudest after H1).
2. Multi-format: notes like a page, a canvas like Excalidraw, one source.
3. Multiplayer: people AND agents on the same board, live, signed.
4. Companion default: a built-in agent that remembers across sessions (a
   resident, not the product).
5. Non-custody: signed, sealed, wallet-owned, revocable, exportable.
6. Resurrection: the app dies, a different client + the wallet wakes the same
   memory.

## Roadmap (NOT submission claims)

The proactive assistant that preps your day and learns from your past.
External sources flow IN as context the agent reads:

- **Google Calendar (read)** — priority real-build spike IF core polish is
  done. OAuth2, free, feasible. Today it is mocked ("context the agent reads").
- **GitHub (read)** — the EASIEST real API (free, OAuth, rich read). Strongest
  candidate if we ship exactly one real integration beat.
- **Social media past posts** — live API is paid/gated (X, ~$100-200/mo + OAuth
  user-context) and largely closed (LinkedIn, Meta). Only honest near-term path
  is user-initiated archive import (X archive .zip into notes). Deferred.

## Do-not-say (saturated or off-claim)

- "all-in-one" / "everything app" (AFFiNE: "Write, Draw, Plan, All at Once";
  Anytype owns "everything app").
- "second brain" / "studio for your mind" / "think better".
- "ai that remembers you" (Personal.ai, Limitless, every chatbot memory).
- "24/7 ai team" (Notion).
- bare "agentic workspace" as the headline (Taskade's category; comprehension
  wall).
- claiming live X / GitHub / GCal sync (not built).
- naming a protocol / API / SDK in marketing copy. NOTE: this is a VOICE
  choice, not an honesty constraint. `anima-mcp` is real and built; we just
  say "connect" and "read and write" instead of jargon.

## Honesty ceiling

Agents "connect" and "read and write" your notes, live and signed. Lean only on
what is true: attribution + signing (name + rev), sealed to Walrus under the
user's keys, revocable guests, wallet-owned blobs, resurrection, export. Claim
no realtime-conflict-resolution or latency guarantees. Integrations are
roadmap, not shipped.
