---
date: 2026-06-10
topic: frontend-surface-map
---

# Frontend Surface Map (Mocked React Build)

## Summary

A mocked React frontend for Anima: landing → one-ceremony onboarding → a five-entry workspace (Home, Companion, Notes, Canvas, Settings) where the companion is present everywhere via a popup chat orb. All web3 and backend behavior is simulated by mock hooks; visual language comes entirely from the existing brand kit and component library.

---

## Problem Frame

The product's contract, backend, and agent loop exist and are tested, but the previous frontend was judged unusable and has been deleted (recoverable via git history). Judges evaluate through the frontend: it must show an agent-native product in the first seconds, demonstrate the custody story without contradicting the architecture (two-key model, wallet-gate on destructive ops only, ephemeral transcripts), and be reviewable surface by surface before the June 17 beat-complete cutoff. There is no surface map: which pages exist, what each shows, and which features are modals was undefined after the reset.

---

## Actors

- A1. Owner (human): connects a wallet, names a companion, writes and organizes notes, shares them, performs destructive ops.
- A2. Companion agent ("Nova" in mocks): greets first, drafts and edits notes with attribution, visibly works (orb states, cursors, write-states).
- A3. Judge/reviewer: opens the app cold; must see agent-first proof and the custody story without guidance.

---

## Key Flows

- F1. First run
  - **Trigger:** New wallet connects from landing.
  - **Actors:** A1, A2
  - **Steps:** connect → guard checks → name companion → one signature (creates vault + funds agent) → progress `creating → preparing → done` → companion greets first on Home.
  - **Outcome:** Workspace ready; Home shows greeting and empty-state quick starts.
  - **Covered by:** R3, R4, R5

- F2. Returning session
  - **Trigger:** Known wallet revisits.
  - **Actors:** A1
  - **Steps:** checking spinner → (if unpaired device) "pair this device" one-button state → waking/rebuild progress ("decrypting memory, quilt N of M") as a hero moment → Home.
  - **Outcome:** Workspace restored with vault data.
  - **Covered by:** R4, R5

- F3. Ask-anywhere
  - **Trigger:** Owner clicks the popup orb on any page (or quick-ask on Home).
  - **Actors:** A1, A2
  - **Steps:** popup chat opens over page → conversation (same state as Companion page) → optional expand to Companion page.
  - **Outcome:** One continuous conversation regardless of entry point.
  - **Covered by:** R8, R9

- F4. Write and seal
  - **Trigger:** Note saved (by owner or agent) anywhere.
  - **Actors:** A1, A2
  - **Steps:** write-state card `encrypting → certifying → certified (provenance link) | failed (+retry)`.
  - **Outcome:** Visible custody proof on every write.
  - **Covered by:** R12, R17

---

## Requirements

**Shell and navigation**
- R1. Sidebar nav has exactly five entries: Home, Companion, Notes, Canvas, Settings. Published lists, tags, and recents live inside parent pages, not in the nav.
- R2. Workspace header shows companion name, memory count, owner short-address, and connect state.

**Onboarding and session states**
- R3. Onboarding is one modal ceremony: connect → guard checks → name companion → one signature → progress states `creating → preparing → done` → companion greets first.
- R4. Session states: `checking` spinner; `pair this device` (single button); waking/rebuild progress styled as a hero moment ("decrypting memory, quilt N of M"), not a generic loader.
- R5. After onboarding or rebuild, the user lands on Home with the companion's greeting as the first interactive element.

**Home (living dashboard)**
- R6. Home order: (1) agent hero strip — orb + greeting + recent agent activity ("Nova summarized 3 notes · view changes") + ask-input; (2) graph preview (clicks through to Canvas); (3) quick-start row (New note · Open canvas · Let Nova draft); (4) recents.
- R7. The orb is the product's living element: breathing idle, working spin, completion badge.

**Companion (chat)**
- R8. Companion is a dedicated chat page: message list, streaming, citation chips that open the referenced note, input bar, ephemeral-transcript caption.
- R9. On every other page the companion appears as a popup chat (floating orb, bottom-right): click opens a compact panel over the page; expand navigates to the Companion page; conversation state is shared. Hidden on the Companion page itself.

**Notes**
- R10. Notes is a full Obsidian-style editor page: note tree at left of page, selected note fills the main area using the kit's editor frame (properties panel, wiki links with hover preview, callouts, checkboxes, bubble toolbar, editable block).
- R11. Agent edits render as attributed suggestion blocks (diff + reason + accept/reject) per the component library.
- R12. Every save shows the write-state card sequence `encrypting → certifying → certified (provenance link) | failed (+retry)`.
- R13. Share dialog (modal from a note): public/password mode pick, publish progress, link + copy state, published-copies list with unpublish.

**Canvas**
- R14. Canvas page: draggable note cards, link edges, human + agent cursors with labels and "is writing…" state, materialize animation for new notes, designed empty state.

**Settings**
- R15. Single sectioned page: Companion identity (rename); Agents & devices (key list, this-device marker, revoke, connect-external-agent flow with secret-shown-once and copyable env block); Balances + top-up prompt; Export vault; Danger zone.
- R16. Wallet confirmation gates destructive operations only (forget, revoke, unpublish); copy celebrates this asymmetry.

**Cross-cutting**
- R17. All chain/backend behavior is mocked behind hook-shaped seams (e.g., vault, session, agent, share) with believable latency so loading choreography is visible; a visible MOCKED indicator appears in dev.
- R18. Visual language comes exclusively from the brand kit and component library (tokens, components, motion laws, system laws); no new visual exploration.
- R19. Empty states are designed (Home first-run, Notes vault, Canvas) per the kit's empty-state pattern.
- R20. Forget flow: select mode in Notes → confirmation dialog enumerating exactly what dies → (mocked) wallet confirm.

---

## Acceptance Examples

- AE1. **Covers R3, R5.** Given a new wallet, when onboarding completes, the first thing rendered is the companion's greeting on Home, with no intermediate dashboard flash.
- AE2. **Covers R4.** Given a returning paired session, when the vault rebuilds, the progress surface shows quilt N of M with hero styling, then lands on Home.
- AE3. **Covers R9.** Given the user is on Canvas and opens the popup chat and sends a message, when they navigate to Companion, the same message and reply are present.
- AE4. **Covers R12.** Given any note save, when the write completes, the card has passed `encrypting → certifying → certified` and exposes a provenance link; a failed write offers retry.
- AE5. **Covers R16.** Given a forget action, when the confirmation dialog appears, it enumerates the exact notes to be destroyed and requires the (mocked) wallet step; non-destructive actions never prompt the wallet.

---

## Success Criteria

- A cold reviewer sees agent-first proof (orb + greeting + agent activity) within the first screen after onboarding.
- Every surface screenshot-matches the kit: passes the System Laws checklist (ink pills, glyph-carried color, SVG icons, motion budget) with no off-system elements.
- The full flow landing → onboarding → Home → note write → share → canvas → settings is walkable in agent-browser with mocks only, no console errors.
- Integration later requires swapping hook internals only; no surface rewrites.

---

## Scope Boundaries

- No web3/backend wiring (mock hooks are the seam; engineer's integration lib is restorable from git).
- No real LLM; scripted/mock agent replies.
- Product name pending (placeholder wordmark; swap on decision).
- Desktop-first; no mobile layouts.
- The deleted handoff's echo/alt and public-reader surfaces are out; do not resurrect.
- No new visual language beyond the kit.

---

## Key Decisions

- Home is a living dashboard rather than chat-first or canvas-first: agent-first hero satisfies hackathon eligibility while keeping the Obsidian-familiar shell.
- Companion = dedicated page + popup orb everywhere else: full conversation room without losing omnipresence; one shared conversation state.
- Notes opens as a full Obsidian-style editor (not list + slide-over): deep-work feel, direct reuse of the kit's editor frame.
- Sidebar stays at five entries: minimal nav; secondary lists live inside pages.
- Real UI directly, no graybox stage: kit components make full fidelity as cheap as wireframes; review happens on screenshots per step.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] Graph preview on Home: live mini force-graph vs static constellation snapshot (performance vs delight).
- [Affects R17][Technical] Mock data shape: one demo vault fixture shared across hooks; how rich (note count, tags, history depth) for believable demos.
- [Affects R14][Technical] Canvas implementation: reuse the component library's CSS canvas vs a lightweight pan/zoom lib.
