# ANIMA — Status Briefing for Collaborating Agents

> Paste-this-first context refresher. If your memory says "ANIMA is a concept
> with zero product code" or "never gate-checked," it is STALE (June-5 era).
> This document is the corrected ground truth as of **2026-06-10 EOD**.
> Authoritative companions: `docs/frontend-handoff.md` (what YOU build if you
> are the brand-kit agent) · `docs/integration.md` (full system contracts) ·
> `docs/plans/2026-06-10-001-feat-anima-mvp-build-plan.md` (origin plan).
> For brand and narrative (NOT build facts), `docs/positioning.md` is canonical and supersedes the framing in section 1.

## 1. What ANIMA is (one paragraph)

An agentic workspace where your own external agents read and write the same notes and canvas as your team: every note is a
human-readable markdown note, Seal-encrypted, stored on Walrus, with the blob
**owned by the user's Sui wallet**, plus a companion chat that lives in the
workspace as a bundled default, a multiplayer canvas where humans AND external agents (Claude Code via
MCP) are peers, per-note publishing to the permaweb, and the "resurrection"
beat: the app dies, a different client (different brand, different LLM) wakes
the same notes from the wallet alone. Sui Overflow 2026, Walrus track
("Programmable Storage for AI Agents & Agentic Workflows" — $35k 1st).

## 2. Build status: WORKING SYSTEM, not concept

All testnet-verified (Sui testnet, live):

| Layer | State | Evidence |
|---|---|---|
| Move contract | ✅ deployed | `0x52e02b193cb65c96f1545f6b4cff944f316f406931a550b7d13d40b4ff06e298` · 9/9 tests · 7 vaults created, 75+ real txs, `register_agent` used by the human owner pairing a real browser |
| chain/core (TS) | ✅ | 23 unit tests · full memory lifecycle executed live: write → cold rebuild (4.7s) → edit → forget(survivors-first) → export zip |
| Go backend | ✅ | 33 tests · stateless (no keys/storage) · auth(nonce→wallet-sig→JWT), SSE chat via OpenRouter, distiller, presence WS hub (zero persistence) |
| anima-mcp | ✅ | live-verified: recall 3ms, remember 13.2s with `author: claude-code`, place_note (canvas), pairing/funding errors actionable |
| End-to-end | ✅ | real-LLM e2e passed: "how did my sister's wedding go?" → cited [[noteId]] answer using the seeded memory; distill → encrypt → Walrus write → instant recall |
| Frontend | 🔁 intentional state | view components REMOVED on purpose (2026-06-10) so the brand-kit agent rebuilds them; the tested integration layer (hooks/libs) is kept and compiling. Full working reference UI preserved at git tag `reference-frontend` |
| Demo vault | ✅ live | seeded "Anima" vault, 14+ memories, owner `0x41af8807…aded39` (testnet demo wallet) |

The track's literal criteria (long-term memory · Walrus file persistence ·
agentic tooling · multi-agent coordination · memory inspect/manage UI ·
"working systems, not demos") — every line has working evidence. The only open
work is packaging: the branded frontend, seed polish, deploy, video, submission.

## 3. Strategy posture (the gate-check, settled)

ANIMA was selected 2026-06-10 via a clean-room restudy (fresh ideation +
landscape sweep + demand evidence), explicitly checked against the MemWal
collision map. Formal G1–G7 pass, as-built: G1 wrap-not-infra ✅ (app on raw
walrus+seal; MemWal not even used) · G2 memory load-bearing ✅ (proven by e2e)
· G3 non-custody ✅ (wallet-owned blobs, app-death survival on a different LLM
vendor, allowlist w/o trusted host — not replicable on Postgres+S3) · G4 no
sybil economy ✅ · G5 no prediction market ✅ · G6 5-min demoable ✅ (beats all
functioning) · G7 business 🔶 (prosumer subscription; not a judged criterion).
MemWal GA footprint is single-user (no allowlist/multi-writer/who-wrote) —
our differentiators are exactly what it lacks, and they are BUILT.

Competitive field: 134 projects / 1,857 participants registered (2026-06-10);
DeepSurge locked per-project listings (mutual invisibility). Shortlist does
NOT exist yet — timeline: submissions close Jun 21 → shortlist Jul 8 → Demo
Day Jul 20–21 → winners Aug 27.

## 4. Architecture facts you must not contradict

- Two-key model: wallet (owns everything, signs ONLY destructive ops + onboarding) ≠ per-device/per-agent Ed25519 keys (silent writes, allowlisted for decrypt via on-chain `seal_approve`).
- Custody asymmetry (core of the pitch): writes are silent; forget/revoke/unpublish REQUIRE a wallet signature.
- User popups, lifetime: 2 at onboarding (one PTB + one auth message), then only destructive ops. Memory writes cost the agent ~0.003 SUI + ~0.0006 WAL per turn from its allowance; reads/decrypts are zero-tx.
- `seal_approve` is dry-run by Seal key servers (off-chain, gas-free) on every decrypt — invisible in tx counts by design.
- Transcripts are ephemeral; only distilled notes persist. Backend transiently sees chat context during inference (we say this honestly), stores nothing.
- Canvas: durable layout = a reserved NOTE (`anima:canvas-layout`, resurrects with the vault); presence/cursors = ephemeral WS relay, never stored.
- Publishing: per-note public (plaintext blob) or password (AES-GCM in-browser); registry = chain attributes; unpublish = wallet delete. Per-note Seal grants deliberately NOT built (latency trade), documented.

## 5. Timeline & roles

- **Jun 21 PT** — submission (public repo, ≤5-min video, DeepSurge, testnet deploy ✅ already).
- **~Jun 17** — brand frontend must be beat-complete, or the `reference-frontend` tag ships instead (working fallback).
- **Brand-kit agent**: build all 12 surfaces in `docs/frontend-handoff.md`, web3-free, mocking the documented hook shapes. Honor the 5 non-negotiables and the IA decisions there.
- **Integrator (chain agent)**: wires real hooks into your pages after; owns seed, README, deploy, mainnet path (Seal mainnet = Enoki/permissioned access, requested via Walrus TG).
- Repo: private `github.com/mfahriferdiansyah/anima` until judging; branch `feat/anima-mvp`; conventional commits, **no AI attribution in commits ever**.
