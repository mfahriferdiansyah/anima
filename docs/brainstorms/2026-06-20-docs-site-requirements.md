---
date: 2026-06-20
topic: docs-site
---

# Anima Docs Site

## Summary

A real public documentation site for Anima at docs.anima.app, self-hosted on
Coolify as a static Starlight (Astro) build, carrying two co-equal tracks (a user
track and a developer track) both built in v1. Agent-readable by default
(llms.txt plus per-page markdown), sequenced after the Jun 21 submission, and
seeded heavily from the existing internal docs.

---

## Problem Frame

Anima has rich internal docs (`docs/positioning.md`, `docs/integration.md`,
`docs/decisions.md`, `docs/status-briefing.md`, `README.md`) but no public
documentation surface. Three readers need one and have nowhere to go: a developer
who wants to connect their own agent over anima-mcp, an end user learning the
workspace, and a Walrus-track judge confirming the system is real. Each is served
today only by a README and internal docs written for collaborating agents, not
for the public.

The cost is concrete. The product's whole wedge is "your own ai tools read and
write your notes," and a developer cannot act on that without a quickstart that
does not exist. An agent-native product whose docs an agent cannot read is
off-brand on day one. One complication shapes the user track: the user-facing
frontend is deliberately torn down for a post-submission rebuild, so several
end-user surfaces are mocked at the UI layer even where the underlying capability
is real in core. User how-tos written now carry a screenshot-and-walkthrough
rewrite cost when the rebuilt UI lands.

---

## Actors

- A1. End user: a note-taker using the Anima workspace (notes, companion, publishing, export).
- A2. Developer: connects their own external agent (Claude Code, Cursor) to a vault via anima-mcp.
- A3. External agent: an AI coding agent that consumes the docs (llms.txt, per-page markdown, or the docs MCP) and acts on them.
- A4. Walrus-track judge: evaluates whether the chain primitive is load-bearing and the system is real. Not a v1 target; the README and positioning carry the judge before the Jun 21 submission, and this site ships after.
- A5. Docs maintainer: the team member, or an agent, who writes and ships docs from the repo.

---

## Key Flows

- F1. Connect your agent (developer quickstart)
  - **Trigger:** a developer wants their own agent reading and writing an Anima vault.
  - **Actors:** A2, A3
  - **Steps:** read the quickstart, generate an agent key in the app, set env plus MCP config, run anima-mcp, the agent recalls and remembers against a live vault.
  - **Outcome:** an external agent reads and writes a real vault in roughly ten minutes, using only the public docs.
  - **Covered by:** R6, R7, R9

- F2. Capture and recall (end user)
  - **Trigger:** a user captures a note and later asks the companion about it.
  - **Actors:** A1
  - **Steps:** create a note, search or ask the companion, get an answer that cites the note, optionally publish or export it.
  - **Outcome:** a user captures, finds, and shares a note using shipped capability.
  - **Covered by:** R10, R11

- F3. Agent reads the docs
  - **Trigger:** a developer points their coding agent at Anima's docs.
  - **Actors:** A3
  - **Steps:** the agent fetches `llms.txt` / `llms-full.txt` or a per-page `.md`, or queries the docs MCP pointer, and answers in context.
  - **Outcome:** the docs are consumable by an agent without scraping HTML.
  - **Covered by:** R13, R14, R15

- F4. Dogfood: agent-authored docs published to Walrus (v2 milestone)
  - **Trigger:** docs content is authored and maintained as an Anima vault.
  - **Actors:** A5 acting through A3, A1
  - **Steps:** an external agent writes the docs notes into a vault over anima-mcp, the vault output is published as a Walrus Site, the blob id is linked from the docs landing.
  - **Outcome:** the docs prove both halves of the moat, agent read/write and survives-the-app, not just survival.
  - **Covered by:** R17

---

## Requirements

**Site, engine, hosting**
- R1. A standalone public docs site at docs.anima.app, its own Coolify app, separate from the marketing landing.
- R2. Built with a docs-as-code static-site generator; markdown/MDX source lives in the Anima repo and versions with the code.
- R3. Self-hosted on Coolify as a pure-static build; no external docs SaaS in the stack.
- R4. Built-in docs search, dark mode, and standard docs chrome without bolt-on hosted services.

**Navigation**
- R5. The site presents two co-equal tracks, "Use Anima" and "Build with Anima," both built in v1, behind a two-panel fork landing with a short "what is Anima" section above the fork.

**Developer track (built in v1)**
- R6. A real Quickstart that takes an external agent from zero to reading and writing a live vault via anima-mcp (install, generate key in the app, env plus MCP config).
- R7. An MCP tool reference for the live tools only (recall, remember, list_notes, read_note), with inputs, outputs, and actionable errors. The canvas-positioning tool is roadmap, not reference.
- R8. A concept spine that answers "why a chain": custody and wallet ownership, the two-key model, Seal encryption, Walrus storage, resurrection, and signed attribution. Adapted from `docs/integration.md` and `docs/positioning.md`.
- R9. A FAQ / troubleshooting page covering faucet limits, session-key refresh, revocation lag, cache-after-delete, and unfunded or unpaired-key errors.

**User track (built in v1)**
- R10. Getting started plus the core note how-tos: capture, search, edit, and delete notes, and the companion answering with cited notes. Documents shipped capability; UI walkthroughs and screenshots are refreshed after the frontend rebuild (see Key Decisions).
- R11. Publishing and export how-tos for the built paths: public and password share, and the markdown-zip export.
- R12. The companion documented honestly as a resident built-in agent (remembers across sessions, writes notes back), not as the product; deeper agent capability points to the developer track.

**Agent-readable layer (default, not a feature)**
- R13. Emit `llms.txt` and `llms-full.txt` at build, covering at least the developer track.
- R14. Make every page available as raw markdown via a per-page URL, surfaced as a "view/copy as markdown" affordance.
- R15. Provide a docs MCP pointer so a coding agent can query the docs. A lightweight pointer over the static `llms.txt`, not an embeddings service.

**Honesty gate and roadmap**
- R16. A hard ship-status gate: only features that ship today are documented as usable. Features that are real in core but mocked in the current frontend (notes, publishing, export) are documented at capability level and flagged for a screenshot pass; genuinely unbuilt surfaces (canvas multiplayer, live calendar, integrations) go to a Roadmap page, never a how-to. The feature inventory in this brainstorm is the ship-status source of truth.

**Dogfood (v2 milestone)**
- R17. The docs content is authored and maintained as an Anima vault via an external agent over anima-mcp, then published as a Walrus Site with the blob id linked from the docs landing. Gated on the Walrus Site publish flow being wired.

---

## Acceptance Examples

- AE1. **Covers R16.** Given canvas multiplayer is marked `[planned]`, when docs are written, canvas appears only on the Roadmap page, not as a user how-to that implies it works.
- AE2. **Covers R6, R7.** Given a developer with a wallet and an empty vault, when they follow the Quickstart, their external agent completes a recall and a remember against the live vault without reading any internal doc.
- AE3. **Covers R10, R16.** Given notes work in core but the note UI is currently mocked, when the user how-to is written, it documents the real capability and is marked for a screenshot pass after the frontend rebuild, rather than being deferred or describing a UI that does not exist.
- AE4. **Covers R14.** Given any published docs page, when an agent requests that page's markdown URL, it receives clean markdown rather than HTML.

---

## Success Criteria

- A developer connects their own agent and writes to a live vault in roughly ten minutes using only the public quickstart.
- A user can capture, find, and share a note by following the user track, with the steps accurate at the capability level even before the post-rebuild screenshot refresh.
- A coding agent can consume the docs (llms.txt, a per-page markdown URL, or the MCP pointer) without scraping HTML.
- No page documents a mocked or `[planned]` surface as shipped; the honesty gate holds against `docs/positioning.md`'s ceiling.
- The site builds from the repo and deploys on Coolify on git push, at docs.anima.app with automatic SSL.
- ce-plan can sequence the build without inventing audience, IA, engine, or scope.

---

## Scope Boundaries

### Deferred for later

- The agent-authored Walrus-Site dogfood (R17), gated on the Walrus Site publish flow.
- Doc versioning across multiple SDK versions (Starlight needs a plugin or branch approach); add only if version-gated docs become a real need.
- A hosted "Ask the docs" AI chat widget.
- An embeddings-based docs search or MCP (context-mcp class); revisit when docs volume outgrows `llms-full.txt`.

### Outside this product's identity

- Positioning the site as a generic notes-app help center. Both tracks ship, but the lead and identity stay on the wedge (your own agent connects here); the user track supports adoption without becoming the site's reason to exist. The undifferentiated user-guide half is content a competitor can copy verbatim.
- The Go backend as a public API surface. It is internal infra; the only supported external surface is anima-mcp.
- Live GitHub, Google Calendar, or X sync, and realtime-conflict or latency guarantees. Roadmap or explicitly disclaimed, never documented as shipped.
- A docs SaaS (Mintlify, GitBook). Hosting docs on someone else's servers contradicts Anima's "not hostage to any app" thesis and blocks the Walrus dogfood.

---

## Key Decisions

- **Engine: Starlight (Astro), self-hosted on Coolify.** Pure-static output is the binding constraint, required by both Coolify's static buildpack and the eventual Walrus Site, which eliminates the server-dependent edge of Next-based options. Starlight stays fully isolated from the Vite/React app and the Go backend (no second framework), emits agent-readable artifacts at build, builds fast, and ships Pagefind search, dark mode, and i18n without add-ons.
- **Reject hosted Mintlify.** It is a SaaS that cannot run on Coolify, it would be the one external dependency in an otherwise self-hosted stack, and it blocks the Walrus dogfood. Trade accepted: assemble the agent layer (llms.txt plugin plus per-page markdown plus an MCP pointer) rather than getting it turnkey, and skip hosted Ask-AI.
- **URL: subdomain docs.anima.app** (user decision). Its own Coolify app, no Astro `base` path, its own SSL cert.
- **Coolify build path.** Use the Nixpacks buildpack (not the "Static" buildpack, which has no build step), tick "Is it a static site?", set publish dir to `dist`; Traefik provisions Let's Encrypt SSL and git push redeploys via the GitHub App webhook. Pin Node with a `nixpacks.toml`.
- **Docs as a self-contained package.** anima is a single flat `package.json` today, not a pnpm workspace. Add `docs/` as its own package with its own lockfile so Coolify's Base Directory can point straight at `docs/` with no workspace-lockfile friction. The root-base-dir plus scoped-build-command workaround is only needed if docs is later folded into a workspace.
- **Agent layer composition.** `starlight-llms-txt` (maintained by a Starlight core maintainer) for `llms.txt` / `llms-full.txt`; a small per-page `.md` route for "view as markdown"; LangChain's `mcpdoc` pointed at the static `llms.txt` for a zero-infra docs MCP. No turnkey self-hostable Mintlify-class platform exists for pure-static in 2026.
- **Equal-weight v1 (user decision).** Both tracks are built in v1. This overrides the dev-first recommendation. The user accepted that user-track UI walkthroughs and screenshots will be rewritten after the post-submission frontend rebuild. The honesty gate (R16) still governs: features real in core but mocked in the current frontend are documented at capability level with a screenshot-refresh flag; genuinely unbuilt surfaces go to Roadmap. Tradeoff acknowledged: the product-lens review flagged the user track as the copyable half that risks diluting the wedge; breadth was chosen for adoption, with the site's lead kept on the wedge.
- **Sequencing: after the Jun 21 submission.** README plus positioning carry the judges; building a public docs site the day before submission would divert polish.

---

## Dependencies / Assumptions

- User-track UI walkthroughs and screenshots will be refreshed after the post-submission frontend rebuild; the user accepted this rewrite cost to ship both tracks in v1.
- The dogfood (R17) depends on the Walrus Site publish flow being wired, and on anima-mcp staying live (it is, testnet-verified).
- The Coolify instance is patched against the January 2026 CVE set before the dashboard is exposed publicly.
- The five live anima-mcp tools and the built share/export path are the documentable surface; the feature inventory in this brainstorm is the ship-status source of truth for R16.

---

## Outstanding Questions

### Resolve Before Planning

- None outstanding. The two v1 user decisions, equal-weight tracks and the docs.anima.app subdomain, are resolved and recorded in Key Decisions.

### Deferred to Planning

- [Affects R2][Technical] Confirm `docs/` as a self-contained package with its own lockfile versus converting the repo to a pnpm workspace.
- [Affects R14][Technical] The exact per-page markdown route and the copy/view-as-markdown affordance.
- [Affects R15][Technical] `mcpdoc` wiring, and whether to advertise the MCP pointer inside the docs themselves.
- [Affects R10][Technical] How the user-track screenshot refresh hooks into the frontend rebuild milestone.
- [Affects R17][Needs research] The Walrus Site publish pipeline for the static `dist` output; Walrus's own docs (docs.wal.app) are the precedent.
