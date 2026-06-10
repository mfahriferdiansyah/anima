---
title: "feat: Mocked frontend rebuild (kit-faithful React app)"
type: feat
status: completed
date: 2026-06-10
origin: docs/brainstorms/2026-06-10-frontend-surface-map-requirements.md
---

# feat: Mocked frontend rebuild (kit-faithful React app)

## Summary

Rebuild `frontend/` as a Vite + React app styled exclusively by CSS ported from the two root-level kit artifacts, with all chain/backend behavior simulated by scenario-aware mock hooks shaped after `docs/integration.md`. Eleven dependency-ordered units run from tokens to a full agent-browser verification sweep; each unit ends with screenshots and a conventional commit on `feat/anima-mvp` (no push).

---

## Problem Frame

The contract, backend, and agent loop are built and tested, but the prior frontend was rejected and deleted from the working tree; judges evaluate through the frontend and the beat-complete cutoff is June 17. See origin doc for the full frame.

---

## Requirements

Traceability is to origin R1–R20, F1–F4, AE1–AE5 (see origin: `docs/brainstorms/2026-06-10-frontend-surface-map-requirements.md`). Plan-added requirements from flow analysis:

- P1. Mock scenario control: session phase is selectable via `?scenario=first-run|returning|unpaired` (persisted under `anima:scenario`), with a scenario switcher + reset inside the dev MOCKED indicator. Without it AE1/AE2 are untestable.
- P2. Failure/escape transitions exist for onboarding (signature rejection, guard failure, close-before-sign), pairing rejection, and rebuild failure — all reusing the failed-card + retry pattern.
- P3. Navigation handoffs are explicit: citation chip → Notes with note selected; "New note" → Notes with focused untitled note; "Let Nova draft" → Notes + scripted suggestion block; graph preview click → Canvas default viewport.
- P4. Popup chat lifecycle: open-state persists across routes; in-flight streams keep rendering; completion while closed shows the orb badge; expand mid-stream hands off seamlessly.
- P5. Agent suggestions targeting the currently-open note append below the user's editing surface and never auto-apply.

**Origin actors:** A1 (owner), A2 (companion agent), A3 (judge/reviewer)
**Origin flows:** F1 (first run), F2 (returning session), F3 (ask-anywhere), F4 (write and seal)
**Origin acceptance examples:** AE1–AE5 carried; each is enforced by a named test scenario or the U11 walkthrough.

---

## Scope Boundaries

- No web3/backend wiring; mock hooks only. Integration later swaps hook internals (shapes mirror `docs/integration.md`).
- No real LLM; scripted agent timelines.
- Product name pending: placeholder wordmark constant (`BRAND_NAME`) used everywhere; one-line swap later.
- Desktop-first; no mobile layouts.
- Do not resurrect echo/alt or public-reader surfaces, or restore deleted frontend files from git.
- Do not touch `backend/`, `chain/`, `contract/`, `scripts/`, `.mcp.json`.
- No Tailwind despite the installed dep (user decision: pure kit CSS).

### Deferred to Follow-Up Work

- Real integration (restore/adapt `useVaultSession` internals from git history): integrator, post-mock.
- Graph-preview deep-linking to a focused canvas node: post-cutoff polish.
- OG/social assets and final name swap: after the name decision.

---

## Context & Research

### Relevant Code and Patterns

- `../brand-kit-slipstream.html` (52.9K) and `../anima-components.html` (116.2K) at the parent directory of the repo: the complete approved CSS + markup patterns (tokens, primitives, editor frame, chat, canvas, graph tabs, marketing kit, System Laws section).
- `docs/integration.md` §2–§6b: authoritative mock-hook shapes — `useVaultSession` phases `disconnected|checking|first-run|needs-pairing|rebuilding{done,total}|ready{vault,agent,index}`; note shape `{noteId, version, updatedAt, author, tags[], links[], title, body}`; write states `encrypting → certifying → certified(blobObjectId) | failed`; canvas layout as reserved note `anima:canvas-layout` with `{noteId:{x,y}}`; share modes + published-copies list; custody invariants (§7).
- Old root scripts: `dev`/`build`/`preview` already point at `frontend/vite.config.ts` — recreating that path makes `pnpm dev` work unchanged.
- Storage namespacing convention: `anima:` prefix for all browser persistence.
- Repo rules (`docs/status-briefing.md` §5): conventional commits, no AI attribution, branch `feat/anima-mvp`, repo private.

### Institutional Learnings

- No `docs/solutions/` exists. Behavior authority carried from the deleted handoff via origin doc: write-state visibility, wallet-gate asymmetry, ephemeral-transcript label, designed empty states, one living element (orb).
- Five surviving non-negotiables are encoded as origin R7, R12, R16, R19 — judges probe them.

### External References

- None needed; stack and patterns are local.

---

## Key Technical Decisions

- Pure kit CSS, Tailwind unused (user-confirmed): tokens + component classes ported 1:1 as global stylesheets preserving kit class names, so kit↔app screenshots stay comparable and System Laws checks apply verbatim.
- Add `react-router-dom` (v7) for routing and `force-graph` (npm, pinned same version as the kit's CDN use) for the Home graph preview (user-confirmed via git call-out).
- State: React context providers over mock stores (`SessionProvider`, `VaultProvider`, `ChatProvider`, `PresenceProvider`); no react-query — believable latency comes from a single `delay()` util with per-action jitter. Simpler seam for the integrator.
- One shared demo fixture module feeds every hook: ~12 notes (incl. one long-titled note), 3 folders, tags, links, canvas positions, agent activity timeline, scripted chat replies, settings fixtures (2 device keys + 1 external agent, balances).
- Canvas: no physics lib — absolute-positioned cards + pointer drag + SVG edges + scripted peer-cursor timelines, ported from the component library's canvas demo.
- Per-unit conventional commits on `feat/anima-mvp`, no push (user-confirmed); first commit records the frontend reset (the uncommitted deletions).
- Mock chat streaming: word-chunk `setInterval` over scripted replies, exposed identically to an SSE-backed implementation (`{delta}` accumulation), so swap-in is mechanical.

---

## Open Questions

### Resolved During Planning

- Graph preview on Home: live mini force-graph (interactive hover only, click navigates), hidden when vault is empty.
- Mock fixture richness: 12 notes / 3 folders / 6-event agent timeline — enough for believable demos on every surface.
- Canvas implementation: hand-rolled drag + SVG edges (no lib), per the component library's proven demo.

### Deferred to Implementation

- Exact easing/duration trims where ported CSS meets React mount/unmount — judged by screenshot during U11.
- Whether the popup chat needs a portal vs in-shell render — decided when the shell exists.

---

## Output Structure

    frontend/
      index.html
      vite.config.ts
      tsconfig.json
      public/favicon.svg
      src/
        main.tsx
        app/
          App.tsx            # router + providers + phase gate
          routes.tsx
          MockedBadge.tsx    # MOCKED indicator + scenario switcher (P1)
        theme/
          tokens.css         # ported from kit section 02
          base.css           # resets, typography, scrollbars
          components.css     # primitives (buttons, pills, toasts, inputs, modals, ink panels)
          editor.css         # editor frame, callouts, suggestion, bubble toolbar
          chat.css           # chat page + popup styles
          canvas.css         # canvas cards, cursors, toolbar
        brand.ts             # BRAND_NAME placeholder constant
        mocks/
          fixture.ts         # the demo vault (notes, folders, timeline, replies, settings)
          delay.ts           # latency util with jitter
          scenario.ts        # ?scenario= + anima:scenario resolution
        hooks/
          useVaultSession.ts # mock phase machine
          useVault.ts        # notes CRUD + forget + write-states
          useChat.ts         # shared conversation store + streaming
          usePresence.ts     # canvas peers + agent cursor timeline
          useShare.ts        # publish/unpublish + published list
        components/          # primitives: Button, Pill, Toast, Modal, Switch, Field, Orb, WriteStateCard
        pages/
          Landing.tsx
          Onboarding.tsx     # ceremony modal + session states (checking/pairing/rebuilding)
          Home.tsx
          Companion.tsx
          PopupChat.tsx
          Notes.tsx          # tree + editor frame
          NoteEditor.tsx
          ShareDialog.tsx
          Canvas.tsx
          Settings.tsx
        tests/
          hooks.test.ts      # vitest: mock hook state machines

---

## Implementation Units

### U1. Foundation: Vite app, tokens, primitives

**Goal:** A running `pnpm dev` with the kit's visual system live: tokens, base styles, and the primitive components rendered on a temporary index page.

**Requirements:** R18; enables all.

**Dependencies:** None.

**Files:**
- Create: `frontend/vite.config.ts`, `frontend/index.html`, `frontend/tsconfig.json`, `frontend/public/favicon.svg`, `frontend/src/main.tsx`, `frontend/src/brand.ts`, `frontend/src/theme/tokens.css`, `frontend/src/theme/base.css`, `frontend/src/theme/components.css`, `frontend/src/components/*` (Button, Pill, Toast stack, Modal, Switch, Field, InkPanel, Orb, WriteStateCard)
- Modify: `package.json` (add `react-router-dom`, `force-graph`)

**Approach:**
- First action, before any code: `pnpm add react-router-dom force-graph` and commit the lockfile, so the executor proceeds from a resolved dependency state.
- Recreate `frontend/vite.config.ts` at the path root scripts expect (`root: __dirname`, react plugin, `@` → `frontend/src`); no tailwind plugin.
- Extract tokens verbatim from the kit's section 02 block; port primitive CSS preserving class names; favicon = ✦ on blue per kit spec.
- Orb component implements R7's three states (breathe/work/badge) using kit keyframes.
- First commit also records the prior frontend deletion.

**Patterns to follow:** kit `tokens.css` block; component library sections 01–03.

**Test scenarios:**
- Test expectation: none — scaffolding and styling; visual verification via screenshot of the primitives page.

**Verification:** `pnpm dev` serves; primitives page screenshot matches kit components side-by-side; no console errors.

---

### U2. Mock layer: fixture, scenarios, hooks

**Goal:** Every hook the surfaces need, scenario-aware, with believable latency, shaped per `docs/integration.md`.

**Requirements:** R17, P1; F1/F2 reachability for AE1/AE2.

**Dependencies:** U1.

**Files:**
- Create: `frontend/src/mocks/fixture.ts`, `frontend/src/mocks/delay.ts`, `frontend/src/mocks/scenario.ts`, `frontend/src/hooks/useVaultSession.ts`, `frontend/src/hooks/useVault.ts`, `frontend/src/hooks/useChat.ts`, `frontend/src/hooks/usePresence.ts`, `frontend/src/hooks/useShare.ts`
- Test: `frontend/src/tests/hooks.test.ts`

**Approach:**
- `useVaultSession` walks the six-phase machine on timers per scenario; `rebuilding` emits `{done,total}` ticks.
- Hooks test DOM-free: phase machines and stores live in framework-free modules under `mocks/`, tested directly by vitest (no jsdom or testing-library needed; add a `test:frontend` script targeting `frontend/`).
- Scenario→fixture mapping: completed `first-run` yields an EMPTY vault (covers empty states + first-run walkthrough); `returning`/`unpaired` load the 12-note fixture; "ready scenario" in tests means `returning` after rebuild completes; rebuild timers short and skippable via the dev switcher for deterministic screenshots.
- `useVault` exposes notes, save (driving write-state sequence `encrypting→certifying→certified|failed`), forget (with enumeration), and a deterministic `failNextWrite()` dev switch for AE4's failure path.
- `useChat`: one store, streaming word-chunks, scripted replies keyed by intent; exposes citation metadata.
- `usePresence`: scripted peer + agent cursor timelines; `savingLayout` flag; layout persisted to the fixture's reserved note (`anima:canvas-layout` shape).

**Test scenarios:**
- Happy path: `scenario=first-run` → phases `checking → first-run`; completing onboarding → `creating/preparing/done` → `ready`.
- Happy path: `scenario=returning` → `checking → rebuilding(0..N) → ready` with monotonically increasing `done`. Covers AE2.
- Edge case: `scenario=unpaired` → `needs-pairing`; `pair()` → rebuilding; `rejectPairing()` → error state retains retry.
- Error path: `failNextWrite()` then save → state ends `failed`, `retry()` → `certified`. Covers AE4.
- Happy path: two consumers of `useChat` see the same message list (shared store). Covers AE3 at hook level.

**Verification:** vitest green; manual: scenario switcher flips phases live.

---

### U3. Shell and router

**Goal:** Workspace chrome: sidebar (5 entries), header (R2), routes, phase gating, MOCKED badge, global toast stack.

**Requirements:** R1, R2, P1; R12's toast home (flow-analysis N1: global stack bottom-left).

**Dependencies:** U1, U2.

**Files:**
- Create: `frontend/src/app/App.tsx`, `frontend/src/app/routes.tsx`, `frontend/src/app/MockedBadge.tsx`, workspace shell component.

**Approach:**
- Routes: `/` (landing), `/app` (Home), `/app/companion`, `/app/notes/:noteId?`, `/app/canvas`, `/app/settings`.
- Phase gate: non-`ready` phases render session-state surfaces (U4) instead of workspace; `disconnected` → landing redirect; disconnect action returns to landing.
- WriteStateCard toasts render in a global bottom-left stack so saves are visible from any surface (avoids the orb's corner).

**Test scenarios:**
- Happy path: `ready` scenario renders sidebar with exactly five entries; header shows companion name, memory count, short address.
- Edge case: deep-link to `/app/notes` while `disconnected` redirects to landing.

**Verification:** screenshots of shell at each phase; navigation works; no console errors.

---

### U4. Landing, onboarding ceremony, session states

**Goal:** The judge's cold open and the kept ceremony, with all failure/escape paths.

**Requirements:** R3, R4, R5, P2; F1, F2; AE1, AE2. Flow gaps M2, M7, M8.

**Dependencies:** U3.

**Files:**
- Create: `frontend/src/pages/Landing.tsx`, `frontend/src/pages/Onboarding.tsx` (ceremony modal + checking/pairing/rebuilding surfaces).

**Approach:**
- Landing: marketing-kit hero (placeholder wordmark, agent-native one-liner, custody line), connect CTA → ceremony; returning scenario skips straight to checking → Home without onboarding flash.
- Ceremony modal: name input → sign step → progress `creating → preparing → done`; close disabled during progress; signature rejection returns to sign step with inline error; close-before-sign returns to landing.
- Rebuild surface: hero-styled "decrypting memory, quilt N of M" with progress; failure state reuses failed-card + retry; pairing surface has retry + disconnect escape.

**Test scenarios:**
- Covers AE1. Happy path: first-run scenario, complete ceremony → first rendered workspace view is Home with the greeting (no dashboard flash).
- Error path: reject signature → inline error, retry completes.
- Edge case: close modal before signing → landing, session still `first-run`.
- Covers AE2. Happy path: returning scenario → rebuild hero with N-of-M, then Home.
- Error path: rebuild failure (dev switch) → failed state with retry.

**Verification:** screenshot each ceremony step + each session state; walkthrough first-run and returning scenarios end-to-end.

---

### U5. Home: living dashboard

**Goal:** Agent-first home per R6/R7.

**Requirements:** R5, R6, R7, R19; P3 (quick-start handoffs); flow-analysis N3/N4 defaults.

**Dependencies:** U3, U6 (execution order is U3 → U6 → U5 so the chat store exists when Home is built; no stub-then-rewire pass).

**Files:**
- Create: `frontend/src/pages/Home.tsx` (hero strip, graph preview, quick-start row, recents).

**Approach:**
- Hero strip: Orb + greeting + agent activity line ("Nova summarized 3 notes · view changes" → Notes) + ask-input that opens popup chat pre-filled.
- Graph preview: mini force-graph from fixture links; hover-only interaction; click → `/app/canvas`; hidden when vault empty (empty state shows quick-starts prominently).
- Quick-starts: New note → `/app/notes` with focused untitled note; Open canvas; Let Nova draft → `/app/notes` + scripted suggestion sequence (P5 timing).

**Test scenarios:**
- Happy path: ready scenario renders all four zones in R6 order.
- Edge case: empty-vault fixture hides graph preview, shows designed empty state.
- Integration: "New note" lands in Notes with editor focused on an untitled note.

**Verification:** screenshots (full + empty vault); quick-start clicks land correctly.

---

### U6. Companion page + popup chat

**Goal:** The conversation surfaces with one shared store and the full lifecycle.

**Requirements:** R8, R9, P3 (citation chips), P4; F3; AE3. Flow gaps M3, M5; N5 (one scripted low-balance banner), N8 (transcript clears on reload + ephemeral caption).

**Dependencies:** U3.

**Files:**
- Create: `frontend/src/pages/Companion.tsx`, `frontend/src/pages/PopupChat.tsx`.

**Approach:**
- Companion page: message list (kit chat styles), streaming, citation chips → `/app/notes/:noteId`, write-state cards inline when replies create notes, ephemeral caption, scripted low-balance banner linking to Settings.
- Popup: floating Orb (hidden on Companion route), opens compact panel; open-state in context so it persists across routes; expand navigates mid-stream without losing the in-flight message; completion while closed → orb badge.

**Test scenarios:**
- Covers AE3. Integration: send in popup on Canvas → navigate to Companion → same message + reply present.
- Happy path: streaming renders incrementally; citation chip navigates to the cited note.
- Edge case: close popup mid-stream → reply completes → orb shows badge; reopening shows completed reply.
- Edge case: reload clears transcript; caption explains ephemerality.

**Verification:** scripted walkthrough across routes with screenshots at each lifecycle state.

---

### U7. Notes: tree + editor

**Goal:** The Obsidian-style page with the kit editor frame and agent suggestions.

**Requirements:** R10, R11, R12, R20, P5; F4; AE4, AE5. Flow gap N2 (forget aftermath), N6 (long titles).

**Dependencies:** U3.

**Files:**
- Create: `frontend/src/pages/Notes.tsx`, `frontend/src/pages/NoteEditor.tsx`.

**Approach:**
- Port editor frame 1:1: properties panel, wiki links (hover preview, unresolved dashed), callouts, checkboxes, bubble toolbar, contenteditable block.
- Suggestion blocks: scripted; if target note is open, append below the editing surface, never auto-apply (P5); accept → write-state sequence; reject fades.
- Save (manual or accept) drives WriteStateCard with provenance link (mock explorer URL).
- Forget: select mode in tree → dialog enumerating exact notes → mocked wallet confirm → editor falls back to empty selection, transcript-scrub line in chat.

**Test scenarios:**
- Covers AE4. Happy path: save → `encrypting → certifying → certified` with provenance link; failure path retries.
- Covers AE5. Happy path: forget dialog enumerates selected notes; non-destructive actions never show wallet step.
- Edge case: suggestion arrives for the open note → appended, user text untouched.
- Edge case: long-titled note truncates per kit tokens in tree, chips, and cards.

**Verification:** screenshots: tree, editor, suggestion accept/reject, forget dialog + aftermath.

---

### U8. Share dialog

**Goal:** Publish flows per R13.

**Requirements:** R13, R16.

**Dependencies:** U7.

**Files:**
- Create: `frontend/src/pages/ShareDialog.tsx`.

**Approach:** mode pick (public/password) → ~3s mocked publish progress (cancel disabled mid-progress) → link + copy burst; published-copies list with wallet-gated unpublish.

**Test scenarios:**
- Happy path: publish public → link + copied state; entry appears in published list.
- Happy path: password mode shows generated password once.
- Error path: unpublish requires mocked wallet confirm (destructive).

**Verification:** screenshots of each dialog state.

---

### U9. Canvas

**Goal:** The constellation per R14 with live presence.

**Requirements:** R14, R19; layout persistence shape per integration.md §6.

**Dependencies:** U3.

**Files:**
- Create: `frontend/src/pages/Canvas.tsx`, `frontend/src/theme/canvas.css`.

**Approach:** constellation-paper board; absolute-positioned note cards (drag via pointer events, positions → mock layout note with "saving layout…" indicator); SVG edges from fixture links; scripted human + agent cursors with labels and "is writing…" state; materialize animation when the agent timeline adds a note; designed empty state.

**Test scenarios:**
- Happy path: drag a card → position persists across route change; saving indicator pulses once.
- Happy path: agent timeline materializes a new card with animation.
- Edge case: empty vault renders designed empty state.

**Verification:** screenshots incl. mid-drag and cursor presence; layout survives navigation.

---

### U10. Settings

**Goal:** Standing state per R15/R16 with N7 micro-edges.

**Requirements:** R15, R16.

**Dependencies:** U3.

**Files:**
- Create: `frontend/src/pages/Settings.tsx`.

**Approach:** sectioned page: Companion identity (rename); Agents & devices (key list, this-device marker with revoke disabled on it, REVOKE wallet-gated, connect-external-agent: generate → secret shown once → reopen shows "already issued — regenerate" → copyable env block); Balances + top-up prompt (target of the U6 banner); Export vault (mock download); Danger zone styling.

**Test scenarios:**
- Happy path: external-agent flow shows secret exactly once; reopen offers regenerate only.
- Error path: revoke on this-device row is disabled with explanation.
- Happy path: revoke on other device requires mocked wallet confirm.

**Verification:** screenshots of each section + the secret-once behavior.

---

### U11. Verification sweep and System Laws audit

**Goal:** Prove the success criteria: full flow walkable, kit-faithful, console-clean.

**Requirements:** All; success criteria in origin.

**Dependencies:** U1–U10.

**Files:** Modify as needed (fixes only); screenshot artifacts to a local `frontend/.shots/` (gitignored).

**Approach:**
- agent-browser walkthrough per scenario: first-run (landing → ceremony → Home → note → share → canvas → settings), returning (rebuild hero → Home), unpaired (pairing → rebuild).
- Console-error gate at every route; screenshot every surface and overlay state.
- System Laws audit vs the kit's section 09 checklist (ink pills, glyph color, SVG icons, motion budget, no white-on-white, writing rules in copy).
- Fix everything found; final commit.

**Test scenarios:**
- Covers AE1–AE5 end-to-end in the browser, per the scripted walkthroughs above.

**Verification:** all three scenario walkthroughs complete with zero console errors; screenshot set reviewed against the kit; origin success criteria checked off.

---

## System-Wide Impact

- **Interaction graph:** router phase-gate touches every surface; popup chat + toast stack are global layers above routes.
- **Error propagation:** all mock failures resolve to visible UI states (failed cards, inline errors) — never silent.
- **State lifecycle risks:** shared chat store and layout persistence must survive route changes (covered by AE3 and U9 tests); transcript intentionally does not survive reload.
- **API surface parity:** mock hook signatures mirror `docs/integration.md` so the integrator swap stays internal-only.
- **Unchanged invariants:** `backend/`, `chain/`, `contract/`, root scripts' command names, repo privacy, commit conventions.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| CSS port drifts from kit | Class names preserved; U11 side-by-side screenshot audit against kit files |
| Overnight autonomy hits an ambiguous design choice | Defaults documented per unit (flow-analysis M/N items); deviations logged in commit messages for morning review |
| force-graph npm version differs from kit's CDN behavior | Pin to the version verified in the kit work; preview is hover+click only |
| contenteditable quirks in React | Editor's editable block is an uncontrolled island (ref-managed), as in the kit |
| Time overrun before Jun 17 | Units ordered so U1–U7 alone form a demoable core; U8–U10 are separable |

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-10-frontend-surface-map-requirements.md`
- Behavior shapes: `docs/integration.md`; timeline/rules: `docs/status-briefing.md`
- Visual system: `../brand-kit-slipstream.html`, `../anima-components.html`
- Flow gap analysis (M1–M8, N1–N9): plan-internal identifiers from the planning session's flow analysis — M = must-fix gaps, N = nice-to-have defaults. Their resolutions are fully inlined in P1–P5 and the unit approaches; the M/N citations mark provenance only, no external document exists.

---

## Review Amendments (2026-06-10 doc review)

Applied from the four-persona review; each is the committed default for execution:

- State architecture simplified: TWO providers only — session (phase gate needs it everywhere) and chat (popup + Companion share state per AE3). Vault, presence, and share are plain module-level stores consumed by hooks; no provider wrappers (one-caller abstraction rule).
- Popup chat store shape: `chatOpen: boolean` and `pendingBadge: boolean` live in the chat context; expand sets `chatOpen=false` then navigates; the badge clears when `chatOpen` transitions to true.
- Citation chips navigate to `/app/notes/:noteId` unconditionally; the `:noteId` param change loads the cited note, replacing the open one (single-editor layout, no special cases).
- "Let Nova draft": U5 sets a `draft-request` flag; the fixture's agent timeline fires the suggestion ~1200ms after Notes mounts with it; U7 only reads the timeline (no cross-unit coordination).
- Forget aftermath: editor renders the Notes designed empty state; tree auto-selects the first remaining note if any; the transcript-scrub line appends to the shared chat store (visible in both Companion and popup).
- Companion rename (U10): inline text field + save, NO wallet gate (non-destructive per R16), success toast, header name updates immediately via session context.
- External-agent regenerate (U10): destructive (invalidates prior key) → mocked wallet confirm, then the secret-shown-once panel with new secret + env block; added to U10 tests.
- Share password mode (U8): password renders once alongside the link with its own copy button; published-copies rows show a 🔒 marker for password shares.
- Home recents: hidden entirely at zero notes (like the graph preview); skeleton shimmer while vault loads.
- U2 hook tests are DOM-free store tests (no jsdom/testing-library deps); kept because they protect the overnight run, scoped minimal.
- `.gitignore`: append `frontend/.shots/` (U1 scaffolding).
- "Shared store" for chat is a behavioral requirement (AE3 depends on cross-route continuity), not an implementation suggestion — integrators must preserve it.

Rejected as intentional-design conflicts (recorded for the integrator): reviving the public reader page and the NoteSlideOver chip target were suggested per `docs/integration.md`, but both contradict the user's frontend reset decisions in the origin doc; integration adapts to the full-page Notes route instead.
