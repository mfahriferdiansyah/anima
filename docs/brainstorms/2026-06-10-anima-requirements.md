---
date: 2026-06-10
topic: anima-owned-agent-memory-vault
---

> Historical brainstorm (2026-06-10). Point-in-time record, not current direction. Canonical positioning lives in `../positioning.md` (anima is an agentic workspace; "notes on a shared canvas"; the moat is your own external agents on non-custodial, wallet-owned, Seal-on-Walrus data that survives the app). The "memory vault + companion" framing below is superseded; build facts (architecture, signing model, dependencies) remain valid.

# ANIMA — An Obsidian-style Memory Vault for AI Agents, with a Companion That Lives In It

## Summary

ANIMA is a user-owned memory vault for AI agents: every memory is a human-readable markdown note stored on Walrus, encrypted with Seal, owned by the user's Sui wallet. Two interfaces share one brain — an Obsidian-style vault view (browse, search, link, edit, delete notes manually) and a companion chat that consults the vault on every turn, writes new memories as notes, and *drives* the vault for you ("show me what you know about my sister" → it navigates there). Any external agent (Claude, Cursor, ChatGPT) connects to the same vault via MCP. No vendor — including us — can read, alter, or take the memory away. Submission for Sui Overflow 2026, Walrus track (deadline June 21, 2026).

---

## Problem Frame

AI products' accumulated memory of their users is their most valuable asset — and users don't own it, can't read it, and lose it at the vendor's whim. The casualties are documented and named: Replika's overnight "lobotomy" (Feb 2023) turned companions users had trained for years into strangers, spawning a grief community; Dot — a memory-first personal AI — shut down Oct 2025 giving users 30 days to export; Meta's acquisition of Limitless (Dec 2025) gave EU users 14 days before permanent deletion of months of recordings; StoryFile's bankruptcy nearly took digital representations of deceased people with it. Meanwhile no product lets a user *see* what their AI remembers about them, let alone edit or curate it — memory is opaque embeddings in a vendor database. Note-taking tools (Obsidian) solved ownership for human notes with "file over app," but a vault of files is inert: it cannot retrieve itself, summarize itself, or talk back. The local-first answer (Kin) is half a solution — devices die too.

Market context: AI companions are a paid category ($221M consumer spend through mid-2025; Replika ~$30M ARR; memory is explicitly the paid-tier differentiator in journaling apps like Rosebud). The Sui Overflow Walrus track asks for exactly this shape: long-term agent memory on Walrus, portable and not platform-locked, with "interfaces to inspect, debug, or manage agent memory" a listed deliverable.

---

## Actors

- A1. Owner: the human whose memory it is — chats with the companion, browses/edits the vault, holds the Sui wallet that owns everything.
- A2. Companion: the resident agent — reads the vault every turn, writes new memories as notes, navigates the vault on request, forgets on command.
- A3. External agents: third-party MCP clients (Claude Desktop/Code, Cursor) granted read/write access to the same vault by the owner.
- A4. The (dead) vendor: any app/model host in the stack — structurally unable to read (Seal) or destroy (Walrus + wallet ownership) the memory. Exists in the demo as the villain.

---

## Key Flows

- F1. Companion conversation with compounding memory
  - **Trigger:** Owner chats with the companion.
  - **Actors:** A1, A2
  - **Steps:** Companion retrieves relevant memory notes from the vault → responds in persona with that context → distills any new durable facts from the exchange into one or more new/updated markdown notes → notes are Seal-encrypted and written to Walrus under the owner's wallet.
  - **Outcome:** The conversation visibly benefits from past memory; the vault grows by readable notes, not opaque rows.
  - **Covered by:** R1, R2, R3, R4

- F2. Vault browsing — manual and companion-driven
  - **Trigger:** Owner opens the vault view, or asks the companion to navigate ("what do you know about X?", "forget that").
  - **Actors:** A1, A2
  - **Steps:** Manual mode: owner browses/searches notes, follows links between them, opens any note, edits or deletes it. Driven mode: companion answers from the vault and surfaces/highlights the exact notes it used; "forget" requests delete the note (visibly).
  - **Outcome:** The owner can always answer "what does my AI know about me, and where did that come from?" — and change it. An edit immediately changes companion behavior.
  - **Covered by:** R5, R6, R7, R8

- F3. External agent shares the brain
  - **Trigger:** Owner connects an MCP client (e.g., Claude Code or Cursor) to their vault.
  - **Actors:** A1, A3
  - **Steps:** Owner authorizes the client → client recalls memories written by the companion and writes its own → notes appear in the same vault view with origin attribution.
  - **Outcome:** Two different vendors' agents demonstrably share one memory in the same session.
  - **Covered by:** R9, R10

- F4. Vendor death and resurrection (the demo's emotional spine)
  - **Trigger:** The companion's host app "shuts down" (simulated live).
  - **Actors:** A1, A2, A4
  - **Steps:** Companion front-end terminated on camera → owner opens a different front-end backed by a *different model vendor* → connects wallet, Seal session decrypts → companion resumes with full memory, referencing specifics from before the shutdown.
  - **Outcome:** The memory provably outlives the app and the model vendor; blobs visible on-chain as owned by the user's address.
  - **Covered by:** R11, R12

---

## Requirements

**Memory substrate**
- R1. Each memory is a discrete, human-readable markdown note (title + body + tags/links), not an opaque embedding record.
- R2. Notes are stored on Walrus (batched via quilts for cost), encrypted with Seal, with ownership bound to the owner's Sui wallet; no service in the stack can read plaintext without the owner's authorization.
- R3. The companion distills conversations into notes automatically; every write is attributable to the agent that made it.
- R4. Memory retrieval is good enough that the companion visibly uses weeks-old context correctly in conversation (the "remembers your sister's wedding" bar).

**Vault interface (the Obsidian face)**
- R5. Owner can list, search, read, edit, and delete any note in a vault UI.
- R6. Notes can link to other notes; the vault surfaces relationships at minimum as backlinks (a visual graph is desirable, not required).
- R7. When the owner edits or deletes a note, the change takes effect in the companion's next response — no rebuild/redeploy.
- R8. When the owner asks the companion about a topic, the companion's answer cites/surfaces the notes it drew from (companion-driven browsing).

**Interoperability (the any-agent face)**
- R9. An MCP server exposes the vault (at minimum: remember, recall, list/read note) so external MCP clients can use the same memory the companion uses.
- R10. The same memory written by one client is retrievable by another within the same demo session.

**Survival (the ANIMA face)**
- R11. The companion can be resurrected on a different front-end and a different LLM vendor with zero memory loss, authenticated only by the owner's wallet.
- R12. Memory blobs and their ownership are independently inspectable on-chain (explorer-visible), proving no-vendor-custody.

**Submission requirements (hackathon)**
- R13. Deployed to Sui testnet minimum with a mainnet-deployable architecture (prize pays 50% only after mainnet deploy); public GitHub repo; ≤5-minute demo video; submitted on DeepSurge before June 21, 2026 PT.

---

## Acceptance Examples

- AE1. **Covers R4, R8.** Given a vault seeded with weeks of history (transparently labeled as seeded in the demo), when the owner asks "how did my sister's wedding go?", the companion answers with specifics and surfaces the source note(s).
- AE2. **Covers R7.** Given a note "Owner's favorite coffee: cappuccino", when the owner edits it to "switched to matcha" and asks the companion for a drink suggestion, the next response reflects matcha — live, no restart.
- AE3. **Covers R9, R10.** Given the companion stored "working on Sui Overflow submission" yesterday, when Claude Code connects via MCP and is asked "what is the owner working on?", it answers from that note; a note Claude writes appears in the vault view with Claude attributed as author.
- AE4. **Covers R11, R12.** Given the companion app is killed on camera, when the owner opens the alternate front-end (different model vendor) and connects their wallet, the companion resumes referencing pre-shutdown specifics, and the demo shows the memory blobs owned by the user's address in the explorer.

---

## Success Criteria

- A judge can retell the product in one sentence ("Obsidian for your AI's memory — and the companion lives in the vault, so it browses itself; the app can die, your friend doesn't").
- The 5-minute video lands all four beats: memory transparency (edit→behavior change), companion-driven browsing, cross-vendor shared memory via MCP, vendor-death resurrection — each beat shown, not narrated.
- Track-fit is line-by-line: long-term memory ✓, portable/not platform-locked ✓, "interfaces to inspect/debug/manage agent memory" ✓ (the vault view is that deliverable, literally).
- Submission complete on DeepSurge by June 21 with public repo + video; testnet deployed; architecture mainnet-ready.
- Handoff quality: ce-plan can derive the build plan from this doc without inventing product behavior — flows F1–F4 are the demo storyboard, R1–R13 are the build checklist.

---

## Scope Boundaries

### Deferred for later

- Visual graph view of the vault (backlinks list is the v1 floor; graph only if week-2 time allows).
- Memory decay/staleness handling, summarization/compaction of old notes.
- Multi-vault / multi-persona support; vault sharing between humans.
- Mobile apps; voice interface.
- Mainnet production deploy with payments (architecture must allow it; doing it is post-hackathon).
- Monetization mechanics (prosumer subscription story appears in the pitch only).

### Outside this product's identity

- Multi-agent coordination platforms, agent marketplaces, agent reputation/work-history — explicitly rejected directions (see repo VOUCH-VERDICT.md).
- "Verifiability/proof as the product" (audit trails, compliance exports) — banned framing; verifiability here is hygiene, never the pitch.
- Memory *infrastructure* (SDK/protocol plays) — MemWal is the sponsor's own infra; ANIMA is an application on the stack, not a competing layer.
- Prediction markets (standing team constraint).

---

## Key Decisions

- Merge the three explored faces (vault-first "Obsidian for agents", companion-first "ANIMA", MCP interop) into one product with the vault as substrate and the companion as the differentiating interface: a normal note app is only manually browsable; ANIMA's companion also browses it for you. — User decision, 2026-06-10.
- Memory as human-readable markdown notes (not opaque embeddings) is the core differentiator vs every incumbent (Replika/ChatGPT memory, Mem0, OpenTusk vaults): transparency + curation is the beat nobody ships.
- Lead villain is vendor custody, evidenced by named incidents (Replika lobotomy, Dot, Limitless/Meta, StoryFile) — emotional, documented, and judges have read the headlines.
- Cross-ecosystem prior art (Replika, Mem0, Obsidian) is neutral-to-positive (proven demand) per the validated rubric (repo RUBRIC-V2.md); only same-stack collisions matter. Closest same-stack neighbors and the differentiation: OpenTusk (infra vaults, headless, closed beta → we are a legible product with a companion), MemWal sample apps `chatbot`/`noter` (single-session references → we ship ownership + resurrection + curation as a product).
- Demo uses transparently-labeled seeded history to show weeks-of-memory effects within an 11-day build window.

---

## Dependencies / Assumptions

- `@mysten/walrus` (v0.6.7) quilt write/read (`writeFiles`/`getFiles`) works relayer-free on testnet — **day-1 commit gate**: full write→read→decrypt round-trip must pass before committing the build (verified as documented, not yet exercised by us).
- Seal mainnet/testnet key servers operational (7 providers); SessionKey flow usable from a web app; retry on indexing-lag errors.
- Testnet WAL available 1:1 for testnet SUI (faucet operational as of June 10).
- OpenRouter reachable with at least two distinct models for the resurrection beat (e.g., Claude → DeepSeek); provider layer modular so direct Anthropic/OpenAI/DeepSeek adapters can replace the gateway later.
- DeepSurge census (June 10): no registered competitor in personal/companion memory; CodeMind (git memory) and Mandate Memory (DeFi audit) are non-colliding neighbors. Assumed to hold through submission — not re-verifiable for the ~98 non-public projects.
- Team: 2–3 TypeScript-strong devs, limited Move (architecture requires no novel Move; ownership via existing primitives).

---

## Deepening Pass (2026-06-10, user-confirmed decisions)

**Architecture (hybrid, user-chosen):**
- `frontend/` React + Vite + TS + dapp-kit + Tailwind — wallet, chat, vault UI. Coolify app 1.
- `backend/` Go (chi) — chat orchestration, LLM calls, distiller prompts, auth. Coolify app 2.
- `chain/` TS pnpm workspace — `core/` (shared Walrus quilts + Seal + vault logic), `mcp/` (`anima-mcp`, stdio, runs user-side via npx — NOT hosted; it decrypts with the user's session). [HTTP chain-service CUT at plan time, user-confirmed: an encrypted pass-through duplicates Walrus's own relay/aggregator, and a signing service would custody blobs — chain logic runs only where the user's keys live. Coolify = 2 apps.]
- `contract/` — the only Move: Seal `seal_approve` access policy (owner + valid session).
- Deploy: Coolify, watched-path redeploys on main; each app has its own Dockerfile.

**Signing model (user-chosen):** connect wallet once → vault creation + session-key grant signed by wallet; routine memory writes signed silently by the scoped, TTL'd, revocable session key; **destructive ops (forget/delete) and revocation require a wallet confirm** — "memories write silently; erasing one requires your signature."

**LLM strategy (user-chosen):** OpenRouter is the default gateway for dev + demo. Go exposes a modular `LLMProvider` interface; the OpenAI-compatible adapter covers OpenRouter/OpenAI/DeepSeek (base URL + key), Anthropic-direct as a later adapter. Resurrection beat switches models through OpenRouter (e.g., Claude → DeepSeek): "same soul, different brain."

**Retrieval custody line:** canonical memory lives ONLY on Walrus (Seal-encrypted); any retrieval/embedding index is a disposable, rebuildable local cache — never the source of truth, so the non-custody claim stays honest.

**Theme (user-chosen): clean futurist.** References: Linear.app (type discipline, restraint), Vercel/Geist (monochrome precision), Raycast (panel density). Inter/Geist type, near-black canvas, hairline borders — and exactly ONE living element: a small breathing violet→cyan gradient orb as the companion's presence; it pulses on recall and source notes glow. Video aesthetic: black, white kinetic type, full-bleed UI.

**Additional flows confirmed:** F0 onboarding (single wallet popup → name companion → vault + session key → chat) and the forget flow's wallet gate (folded into F2's "forget" path; listing matching notes → wallet confirm → deletion verifiable by re-asking).

**v1 capability list:** remember (auto-distill) · recall with citations · browse/search/backlinks · edit · forget (wallet-gated) · persona continuity · MCP share · export vault as markdown zip (the file-over-app receipt) · resurrection · on-chain inspect · vault stats (note count, oldest memory, storage cost in WAL/$).

**Repo:** private GitHub repo `anima-companion-ai` (sibling under ~/Documents/Repositories), structure above + `docs/` + `README.md`.

---

## Outstanding Questions

### Resolve Before Planning

- (none — product decisions are settled)

### Deferred to Planning

- [Affects R2][Technical] Quilt batching granularity: one note per quilt entry vs session-batched; cost/latency trade-off on testnet.
- [Affects R4][Technical] Retrieval approach within 11 days: embedding search (which provider, where stored — must not undermine the non-custody claim) vs tag/keyword + recency; pick the simplest that passes AE1.
- [Affects R9][Technical] Build MCP server from scratch vs adapt `memwal-mcp` patterns; attribution metadata format for R3/AE3.
- [Affects R11][Technical] Seal session/key UX for the resurrection beat — pre-warm session keys to keep the live beat fast and reliable; fallback: pre-recorded segment inside the live video if key-server latency is unacceptable on camera.
- [Affects R13][Needs research] Exact DeepSurge submission fields (team, video link, tracks) — create the project entry early; it is editable until deadline.
