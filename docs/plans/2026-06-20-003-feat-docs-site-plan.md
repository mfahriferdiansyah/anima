---
title: "feat: Anima public docs site (Starlight on Coolify)"
type: feat
status: completed
date: 2026-06-20
origin: docs/brainstorms/2026-06-20-docs-site-requirements.md
deepened: 2026-06-20
---

<!-- Brand voice and the honesty ceiling are canonical in docs/positioning.md. All published
     docs copy follows it: sentence case, lowercase "ai", no em dashes, AI-tell blocklist,
     do-not-say list. Commits in this repo carry no AI attribution. -->

<!-- MIGRATION NOTE (2026-06-20, post-completion): the site was BUILT per this plan, then the
     engine was migrated from Starlight to FUMADOCS (Next.js, static export) because the user
     preferred its aesthetic. Live site = the self-contained Fumadocs package at `docs-site/`
     (build -> static `out/`). The unit scope + content + agent-readable goals all shipped, but
     on Fumadocs: llms.txt / llms-full.txt / per-page `.md` / the copy-markdown button are
     Fumadocs built-ins; Coolify publishes `out/`; the Starlight files under `docs/` were removed.
     U4 (scripts/pair.ts) is engine-independent and unchanged. See memory anima-docs-site-decisions. -->

# feat: Anima public docs site (Starlight on Coolify)

## Summary

Stand up a self-contained Starlight (Astro) docs package under `docs/`, deploy it on Coolify at docs.anima.app as a pure-static build, and ship both a user track and a developer track plus an agent-readable layer (llms.txt, per-page markdown, an mcpdoc pointer). The developer wedge is made real by a small owner-run pairing command so "connect your agent" works the day the docs ship. All pages are product-facing; internal status and mechanics are authoring inputs, never published content.

---

## Problem Frame

Anima has no public documentation surface. A user learning the workspace, a developer connecting their own agent over anima-mcp, and an agent consuming the docs all have nowhere to go but a README and internal docs written for collaborators. The product's wedge ("your own ai tools read and write your notes") is unusable without a quickstart that actually works for an outsider. See origin: `docs/brainstorms/2026-06-20-docs-site-requirements.md`.

---

## Requirements

Plan requirements trace to the origin requirements doc. Grouped by concern; origin R-IDs in parentheses.

**Site, engine, hosting**
- R1. Standalone docs site at docs.anima.app, its own Coolify app, pure-static build, docs-as-code with markdown/MDX in the repo, built-in search and dark mode (origin R1, R2, R3, R4).

**Developer track (built in v1)**
- R5. Quickstart that takes an external developer from zero to an agent reading and writing a live vault via anima-mcp, anchored on a real, usable pairing path (origin R6; F1; AE2).
- R6. MCP tool reference, hand-curated to the live tools (recall, remember, list_notes, read_note), with inputs, outputs, and the errors a caller actually sees (origin R7).
- R7. Concept pages explaining how Anima works: custody and wallet ownership, the two-key model, Seal, Walrus, resurrection, signed attribution (origin R8).
- R8. FAQ / troubleshooting covering the real failure cases a developer or agent hits (origin R9).

**User track (built in v1)**
- R10. Getting started plus note how-tos (capture, search, edit, delete) and the companion answering with cited notes, at capability level (origin R10; F2).
- R11. Publishing and export how-tos for the built paths: public and password share, and the markdown-zip export (origin R11).
- R12. The companion documented honestly as a resident built-in agent, not as the product (origin R12).

**Self-hosting (added 2026-06-20, extends origin)**
- R17. A Build-track guide to run a self-hosted Anima instance (the static frontend and the stateless Go backend; chain interactions run client-side via the anima library and anima-mcp runs user-side) against your own configuration, including a Coolify path, scoped to what is actually runnable today. Reinforces the custody thesis: a self-hosted instance is stateless and your notes stay on Walrus under your wallet.

**Agent-readable layer (default)**
- R13. Emit llms.txt and llms-full.txt at build, scoped to at least the developer track, with the scope stated in the artifact (origin R13).
- R14. Every page available as clean raw markdown via a per-page URL, plus a copy-as-markdown affordance (origin R14; AE4).
- R15. A docs MCP pointer (mcpdoc over the static llms.txt) a developer can add to their agent (origin R15).

**Navigation and product-facing discipline**
- R16. Two co-equal tracks ("Use Anima", "Build with Anima") behind a two-panel fork landing with a short "what is Anima" above the fork (origin R5-nav). Internal ship-status is an authoring rule, never a published section: features that are not real are omitted, not labeled (refines origin R16 per user direction 2026-06-20 — docs are product-facing, no internal leakage).

**Origin actors:** A1 (end user), A2 (developer), A3 (external agent reading the docs), A5 (docs maintainer). A4 (Walrus-track judge) is not a v1 target; the README and positioning carry the judge.
**Origin flows:** F1 (connect your agent), F2 (capture and recall), F3 (agent reads the docs). F4 (agent-authored Walrus-Site dogfood) is deferred to v2.
**Origin acceptance examples:** AE2 (covers R5, R6), AE4 (covers R14). AE1 and AE3 are carried as the internal authoring rule (unbuilt surfaces such as canvas multiplayer are omitted from the docs; user how-tos document real capability) rather than as published "roadmap/status" content.

---

## Scope Boundaries

### Deferred for later

Carried from origin (product sequencing):
- The agent-authored Walrus-Site dogfood (origin R17, F4), gated on the Walrus Site publish flow.
- Doc versioning across multiple SDK versions.
- A hosted "Ask the docs" AI chat widget.
- An embeddings-based docs search or MCP (revisit when content outgrows llms-full.txt).
- Turnkey mainnet self-hosting (depends on Seal mainnet access, Enoki/permissioned); the v1 self-host guide is testnet-scoped.

### Outside this product's identity

Carried from origin (positioning):
- Positioning the site as a generic notes-app help center. The lead and identity stay on the wedge; the user track supports adoption without becoming the site's reason to exist.
- The Go backend as a public API surface. The only supported external surface is anima-mcp.
- Live GitHub, Google Calendar, or X sync, and realtime-conflict or latency guarantees. Omitted, never documented as shipped.
- A docs SaaS (Mintlify, GitBook).

### Deferred to Follow-Up Work

Plan-local implementation sequencing:
- User-track UI screenshots and step-by-step walkthroughs: shot after the frontend rebuild (`docs/plans/2026-06-10-002-feat-mocked-frontend-rebuild-plan.md`) lands stable surfaces. v1 user pages ship at capability level.
- Fixing the in-app "Connect external agent" env block so the app emits a runnable config (currently mocked: emits a non-`suiprivkey` key and omits `ANIMA_OWNER_ADDRESS`). Tracked as a frontend-rebuild fix-note; the docs do not depend on it because the pairing command (U4) is the documented path.

---

## Context & Research

### Relevant Code and Patterns

- **Flat package, not a workspace.** Root `package.json` has no `workspaces` field and there is no `pnpm-workspace.yaml`, so a root install does not descend into a new `docs/` package. `docs/` with its own `package.json` and `docs/pnpm-lock.yaml` is fully isolated. Root `.gitignore` patterns (`node_modules/`, `dist/`) are unanchored, so they already cover `docs/node_modules/` and `docs/dist/`.
- **No CI and one unrelated container.** No `.github/`, no `nixpacks.toml`, no deploy scripts. `backend/Dockerfile` is a separate Go Coolify app and is not a template for the docs site. The docs deploy is greenfield.
- **anima-mcp tools** (curate the reference from these): server `chain/mcp/src/index.ts` (tool schemas), handlers `chain/mcp/src/tools.ts`, chain glue and error types `chain/mcp/src/vaultClient.ts`, env `chain/mcp/src/config.ts`. Live verified end-to-end path: `chain/mcp/src/smoke.ts` (the pattern the pairing command mirrors). Note wire format: `chain/core/src/notes.ts` (`serializeNote`), types `chain/core/src/types.ts`.
- **Pairing and funding primitives** (for U4): `chain/core/src/vault.ts` (`buildRegisterAgentTx` → the `register_agent` Move entry), `chain/core/src/funding.ts` (thresholds and WAL acquisition).
- **Publishing and export** (for user-track how-tos): `chain/core/src/share.ts` (`publishNote` public/password, `listPublished`, `shareUrl`), `chain/core/src/exportVault.ts` (`exportVaultZip`), forget/delete `chain/core/src/quilts.ts`.
- **Plan-file convention** (from the two existing plans in `docs/plans/`): `YYYY-MM-DD-NNN-<type>-<slug>-plan.md`, `NNN` a global counter, hence `003` here.

### Institutional Learnings

- No `docs/solutions/` tree exists; the team's living knowledge is `docs/decisions.md` plus project memory. The concept pages and FAQ must match the verified mechanics in `docs/decisions.md` (custody Option B: agent writes then `transferObjects(blob → wallet)`; revocation re-consults key servers on a fresh SessionKey; reads may briefly serve from cache after delete; faucet is per-IP rate-limited). That log is dated 2026-06-10; re-verify against current `chain/` before publishing any claim as fact.
- `docs/positioning.md` is the honesty ceiling and brand-voice source. Apply its do-not-say list and "claim only what is true" rule to every page.

### External References

Verified during the brainstorm and Phase 1 research (2026):
- Starlight scaffold and config: content collection (`src/content.config.ts` with `docsLoader` + `docsSchema`), `astro.config.mjs` with `site: 'https://docs.anima.app'` and no `base`, sidebar groups, Pagefind search (`pagefind: true`, default), dark mode default. https://starlight.astro.build/
- `starlight-llms-txt` (now `delucis/starlight-llms-txt`): emits `llms.txt`, `llms-full.txt`, `llms-small.txt`; `customSets` scopes a dev-track artifact. https://delucis.github.io/starlight-llms-txt/
- Per-page markdown: `starlight-md-txt` (clean markdown from MDX, AST-based) + `starlight-copy-button` (copy-as-markdown button); fall back to a hand-rolled `src/pages/[...slug].md.ts` endpoint only if a custom `.md` URL is required. https://starlight.astro.build/resources/plugins/
- `mcpdoc` (`langchain-ai/mcpdoc`): zero-infra pointer over a static `llms.txt`, run via `uvx`, added to a client's `mcpServers`. https://github.com/langchain-ai/mcpdoc
- Coolify static deploy: Nixpacks buildpack (not the "Static" buildpack), "Is it a static site?" on, publish dir `dist`, Traefik Let's Encrypt; pin Node via `nixpacks.toml`.

---

## Key Technical Decisions

- **Product-facing docs; honesty is an internal authoring rule.** Pages document what the product does and how it works. Internal status (mocked / partial / planned), internal file paths, build logs, and bug notes never appear in published content. Unbuilt surfaces are simply omitted, not labeled. (User direction, 2026-06-20.)
- **Engine and host: Starlight (Astro) self-hosted on Coolify at docs.anima.app**, subdomain (no Astro `base`), Nixpacks static buildpack, publish dir `dist`, Node pinned via `nixpacks.toml`. (Origin Key Decisions.)
- **`docs/` is a self-contained package** with its own `package.json` and `docs/pnpm-lock.yaml`; Coolify Base Directory points at `docs/`. No workspace conversion.
- **Agent layer assembled, not bought:** `starlight-llms-txt` + `starlight-md-txt` + `starlight-copy-button`, with `mcpdoc` as the published pointer. Per-page `.md` must round-trip MDX components to clean markdown (AE4).
- **MCP reference is hand-curated to the four live tools, never auto-generated** from the running server's registered tools. The server also registers `place_note`, which depends on the unshipped canvas; auto-generating the reference would publish it. Curation keeps the docs to what a developer can actually use.
- **"Connect your agent" is anchored on a real owner-run pairing command (U4), not the app's connect flow.** The command lives at `scripts/pair.ts` with a root `pair` script (mirroring `scripts/seed.ts`), is owner-signed admin code (not pure glue: `register_agent` is owner-only), funds with two signers (owner funds SUI, agent swaps for WAL so the agent clears both thresholds), and ships a revoke path. `chain/mcp/src/config.ts` (`loadConfig`) is the single source of truth for the four-var env contract that this command and any future in-app fix must match. UI-independent, so the dev track does not inherit the frontend rebuild's churn.
- **Agent-layer integrity is verified by build-time and test assertions inside the docs package; no new CI.** The repo runs no CI and deploys via Coolify; integrity checks ship as a runnable check, not a GitHub Actions surface.

---

## Open Questions

### Resolved During Planning

- Where does the docs package live and how does it avoid colliding with the Vite app: a self-contained `docs/` package with its own lockfile (flat-repo confirmed).
- Per-page markdown approach: maintained plugins (`starlight-md-txt` + `starlight-copy-button`); hand-rolled endpoint only as fallback.
- CI posture: build-time/test assertions in the docs package, no GitHub Actions.
- Quickstart pairing path: a real owner-run command (option A, user-confirmed).
- Pairing command home and packaging: `scripts/pair.ts` plus a root `pair` script (mirrors `scripts/seed.ts`); there is no `chain/mcp` package or published bin to subcommand.
- Owner-key handling: load from a gitignored key file (the `.spike-keys.json` pattern) or stdin, never a CLI positional arg, never logged.
- Pairing idempotency: accept an optional existing agent key and pre-check the vault, rather than minting a new funded agent every run.

### Deferred to Implementation

- The `/read.html` public reader: `shareUrl()` hardcodes it but no `read.html` source exists in the current frontend, so resolve toward documenting the share capability with no reader link in v1; verify a live reader before linking one.
- Invocation ergonomics of the pairing command: `pnpm pair` is the default (location resolved to `scripts/pair.ts`). anima-mcp itself currently runs from the repo (`.mcp.json` uses a local `tsx` path, not a published package), so an external developer already needs the checkout; a published anima-mcp bin would be the trigger to also ship `pair` as a subcommand.
- The precise Coolify/Traefik response headers needed so `mcpdoc` can fetch the static `llms.txt` (plain text, open CORS, no auth wall). Confirm on first deploy.
- Whether a self-hosted instance is fully runnable from documented config alone on testnet — verify the backend env surface against `backend/README.md` before publishing U10. Turnkey mainnet self-host depends on Seal access (Enoki/permissioned) and is out of scope for the v1 guide.

---

## Output Structure

    docs/                              # self-contained Astro/Starlight package
      package.json
      pnpm-lock.yaml
      nixpacks.toml                    # pin Node for Coolify
      astro.config.mjs                 # starlight + plugins; site, sidebar
      tsconfig.json
      src/
        content.config.ts              # docs collection (docsLoader + docsSchema)
        content/docs/
          index.mdx                    # two-panel fork landing + "what is Anima"
          use/                         # Use Anima (user track)
            getting-started.mdx
            notes.mdx
            publishing-and-export.mdx
            companion.mdx
          build/                       # Build with Anima (developer track)
            quickstart.mdx
            mcp-reference.mdx
            faq.mdx
            self-hosting.mdx
            concepts/
              custody-and-ownership.mdx
              two-key-model.mdx
              seal-encryption.mdx
              walrus-storage.mdx
              resurrection.mdx
              signed-attribution.mdx
        pages/
          [...slug].md.ts              # only if hand-rolled per-page markdown is needed
      scripts/
        check-agent-layer.ts           # build-time assertions against docs/dist/
        check-serving.ts               # post-deploy serving smoke (live URL)
    scripts/                           # repo-root scripts (alongside seed.ts)
      pair.ts                          # owner-run pairing + revoke command (U4)
      pair-smoke.ts                    # standalone testnet pair check

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Two flows the plan must make real:

**Connect your agent (F1), anchored on the pairing command:**

```
owner runs `pair` (owner signer from a gitignored key file)   [pattern: scripts/seed.ts]
  -> mint or reuse an agent Ed25519 keypair (pre-check the vault first)
  -> register_agent + fund SUI, owner-signed                  [chain/core/src/vault.ts]
  -> agent-signed exchangeSuiForWal to clear MIN_AGENT_WAL     [chain/core/src/funding.ts]
  -> emit the four env vars (agent key is the one secret):
       ANIMA_AGENT_KEY, ANIMA_VAULT_ID,
       ANIMA_OWNER_ADDRESS, ANIMA_AGENT_NAME              [contract: chain/mcp/src/config.ts]
developer pastes env + mcpServers snippet into Claude Code / Cursor
  -> anima-mcp runs, agent calls recall / remember against the live vault
revoke path (buildRevokeAgentTx) is the documented kill switch
```

Pairing uses two signers: the owner signs register + SUI fund; the agent signs the WAL swap. A SUI-only agent connects but fails its first write, so the gate is a real `remember`, not env-parse.

**Agent-readable layer (F3):**

```
build: starlight-llms-txt   -> /llms.txt, /llms-full.txt (dev-track customSet)
       starlight-md-txt     -> /<page>.md (clean markdown, MDX round-tripped)
serve (Coolify/Traefik):    text/plain + open CORS, no auth wall
consume: mcpdoc --urls "Anima:https://docs.anima.app/llms.txt"  (client mcpServers)
```

Content sources map to product-facing pages (internal docs are accuracy inputs only): concepts adapt `integration.md` §1/§7 + `positioning.md`; MCP reference adapts `integration.md` §4 (live tools only); publishing/export adapt `integration.md` §6b + `chain/core/src/share.ts`/`exportVault.ts`.

---

## Implementation Units

Grouped into four phases. U-IDs are stable and never renumbered.

### Phase 1 — Foundation

### U1. Scaffold the self-contained Starlight docs package

**Goal:** A buildable Starlight site under `docs/` with the two-track sidebar shell, landing placeholder, search, and dark mode.

**Requirements:** R1, R16

**Dependencies:** None

**Files:**
- Create: `docs/package.json`, `docs/pnpm-lock.yaml`, `docs/astro.config.mjs`, `docs/tsconfig.json`, `docs/src/content.config.ts`, `docs/src/content/docs/index.mdx`
- Create: `docs/src/content/docs/use/getting-started.mdx`, `docs/src/content/docs/build/quickstart.mdx` (placeholders so the sidebar groups resolve)

**Approach:**
- Scaffold Astro + Starlight as an isolated package (own lockfile). `astro.config.mjs`: `site: 'https://docs.anima.app'`, no `base`; `sidebar` with two top-level groups ("Use Anima" autogenerating `use/`, "Build with Anima" autogenerating `build/`); Pagefind search default on. Pin sidebar order explicitly (per-page `sidebar.order` frontmatter or an explicit `items` array): Starlight autogenerate sorts alphabetically, which would push Quickstart last in Build and lead Use with Companion.
- `content.config.ts` defines the `docs` collection with `docsLoader` + `docsSchema`.
- Confirm the package is inside the anima git repo and not ignored (root `.gitignore` already covers `node_modules/`/`dist/`).

**Patterns to follow:** Standard `npm create astro -- --template starlight` layout; reference the existing repo's pnpm toolchain.

**Test scenarios:**
- Happy path: `astro build` produces `docs/dist/` with the two sidebar groups rendered and Pagefind search assets present.
- Edge case: a draft page prefixed `_` is excluded from the build.
- Edge case: sidebar order matches the intended sequence (Quickstart first in Build, Getting started first in Use), not alphabetical.
- Verification anchor for U2 deploy.

**Verification:** `docs/dist/` builds clean from `docs/` with both nav groups and working search; dark/light toggle present.

---

### U2. Coolify deploy configuration

**Goal:** The site deploys on Coolify at docs.anima.app on git push, with serving headers that let `mcpdoc` fetch the static llms files.

**Requirements:** R1, R15

**Dependencies:** U1, U3

**Files:**
- Create: `docs/nixpacks.toml` (pin Node)
- Create: `docs/README.md` (maintainer notes: Coolify Base Directory `docs/`, Nixpacks buildpack, "Is it a static site?" on, publish dir `dist`, Watch Paths `docs/**`, domain + Traefik SSL, the serving contract)

**Approach:**
- Pin Node in `nixpacks.toml` so Nixpacks does not pick an incompatible version.
- Document the in-dashboard Coolify config (this is configuration, not code): Nixpacks (not the Static buildpack), static-site mode, publish `dist`, Base Directory `docs/`, custom domain, automatic SSL, and Watch Paths scoped to `docs/**` so a non-docs commit on the shared branch does not redeploy the docs app.
- Capture the serving contract for the agent layer: `/llms*.txt` served as `text/plain` and per-page `.md` URLs served as `text/markdown` or `text/plain` (not `application/octet-stream` or force-download), reachable without an auth or challenge page. Treat browser CORS as verify-on-first-deploy rather than a hard requirement, since `mcpdoc` fetches server-side via `uvx`.
- Two-touch sequencing: `nixpacks.toml` ships with U1's scaffold, but the serving-contract section of `docs/README.md` documents U3's artifacts, so finalize it after U3 (this unit declares the U3 dependency for that reason).

**Test scenarios:**
- Integration: a push that touches `docs/` triggers a Coolify rebuild that serves `docs/dist/` at the domain with valid SSL; a commit touching only non-docs paths does NOT trigger a docs rebuild (Watch Paths `docs/**`).
- Error path: an unpinned Node version is caught by the `nixpacks.toml` pin (build uses the pinned version).
- Integration: `curl` of `/llms.txt` on the deployed site returns `200` with `content-type: text/plain`, and a per-page `.md` URL returns `text/markdown`/`text/plain`, neither behind an auth wall.

**Verification:** docs.anima.app serves the built site over HTTPS; `/llms.txt` is fetchable by a remote client without an auth wall.

---

### U3. Agent-readable layer

**Goal:** The build emits llms.txt / llms-full.txt scoped to the developer track, every page has a clean `.md` URL, and pages carry a copy-as-markdown button.

**Requirements:** R13, R14, R15

**Dependencies:** U1

**Files:**
- Modify: `docs/astro.config.mjs` (register `starlight-llms-txt`, `starlight-md-txt`, `starlight-copy-button`; `customSets` for a `build/**` dev-track set)
- Modify: `docs/package.json` (plugin deps)
- Create (fallback only): `docs/src/pages/[...slug].md.ts` if a custom `.md` URL shape is required

**Approach:**
- Configure `starlight-llms-txt` with a `customSets` entry scoping a developer-track artifact; set the `llms-full.txt` header text to state its scope (so an agent does not read absence-of-user-content as a missing feature).
- Use `starlight-md-txt` for per-page markdown and `starlight-copy-button` for the affordance. Verify MDX components (tabs, asides, cards) round-trip to clean markdown.
- Publish the `mcpdoc` client snippet inside the dev track (the human-readable instruction lives in the Quickstart/reference; this unit only ensures the artifact it points at exists and serves correctly).

**Patterns to follow:** `delucis/starlight-llms-txt` config; Starlight plugins array.

**Test scenarios:**
- Happy path: build emits `/llms.txt` and `/llms-full.txt`; every URL referenced in `llms.txt` resolves in `docs/dist/`.
- Covers AE4. Integration: requesting a content page's `.md` URL returns markdown, not HTML, and an MDX-component page serializes to clean markdown (round-trip assertion, not just existence).
- Edge case: `llms-full.txt` header declares developer-track scope.
- Error path: a broken internal link surfaces as a failed link-resolution check, not a silent 404 at runtime.

**Verification:** llms files build and self-resolve; `.md` URLs return clean markdown; copy button present on pages.

---

### Phase 2 — Make the wedge real

### U4. Owner-run agent pairing command

**Goal:** A command the vault owner runs to authorize, fund, and emit a working agent env, plus a revoke path, so the Quickstart is executable by an outsider today, independent of the app UI.

**Requirements:** R5

**Dependencies:** None (builds on existing chain primitives, but is net-new owner-signed admin code, not pure glue)

**Files:**
- Create: `scripts/pair.ts` (pair + revoke; mirrors `scripts/seed.ts`)
- Modify: `package.json` (add a root script, e.g. `pair: tsx scripts/pair.ts`, mirroring `seed` / `mcp:smoke`)
- Create: `scripts/pair-smoke.ts` (standalone testnet check; mirrors `chain/mcp/src/smoke.ts`, not a vitest case)
- Test: a vitest unit test for the pure logic (idempotency pre-check, error formatting). Place it where an existing runner covers it — co-located under `chain/**/src/__tests__` so `test:chain` runs it (pair.ts imports `chain/core`), or add a `test:scripts` runner — not an uncovered `scripts/__tests__`.

**Approach:**
- This is owner-signed admin code, not glue. `register_agent` is owner-only (`contract/sources/vault.move` asserts sender == owner), so the command must load an owner signer and sign with it. Mirror `scripts/seed.ts`, not `smoke.ts` (smoke.ts is only an MCP client harness that verifies an already-paired env; it never registers or funds).
- Owner-key input: load from a gitignored key file (the existing `.spike-keys.json` pattern) or an interactive stdin prompt. Never a CLI positional argument (it lands in shell history and `ps`) and never logged or echoed. `.gitignore` already covers `.env` / `.spike-keys.json`.
- Two-signer funding (the default does not compose): `buildRegisterAgentTx` inline-funds SUI only (0.2 SUI default) and `register_agent`/faucet are SUI-only, but the MCP write path hard-requires WAL ≥ `MIN_AGENT_WAL` (~0.02 WAL) and never self-heals. So fund the agent SUI above the swap floor, then run an agent-signed `exchangeSuiForWal` (`chain/core/src/funding.ts`) so the agent clears both `MIN_AGENT_SUI` and `MIN_AGENT_WAL`. Owner signs register + SUI fund; the agent signs the WAL swap. Pin the SUI fund explicitly to at least ~0.3 SUI: the 0.2 default minus a 0.15 swap leaves ~0.05 SUI, below the 0.1 `MIN_AGENT_SUI` gas reserve, so the first write still fails. State the target post-pairing balances (sui ≥ 0.1 SUI AND wal ≥ 0.02 WAL) rather than relying on the `buildRegisterAgentTx` default; avoid double-funding (pass an explicit fund amount or `0n` if adding a separate transfer).
- Idempotency: minting a new key every run leaves orphaned funded agents on an unbounded allowlist and drains the owner wallet (same-key re-register aborts atomically and cannot double-fund). So accept an optional existing agent key and pre-check `readVault` / is-agent before submitting, reporting "already paired" cleanly rather than catching a raw Move abort.
- Output: emit `ANIMA_AGENT_KEY`, `ANIMA_VAULT_ID`, `ANIMA_OWNER_ADDRESS`, `ANIMA_AGENT_NAME`, conforming exactly to the env contract in `chain/mcp/src/config.ts` (`loadConfig`) — the single source of truth the eventual in-app fix must also match. By default WRITE the secret `ANIMA_AGENT_KEY` to a named gitignored file and print only its path; gate raw-key stdout behind an explicit flag with a warning. Add an explicit `.gitignore` entry for that output file: the existing `.spike-keys.json` rule is path-specific and will NOT cover a new file.
- Revoke: expose a revoke path (reuse `buildRevokeAgentTx`) so a minted key has a documented kill switch.
- Actionable errors in the MCP style (no stack traces): under-funded owner, faucet rate-limit, invalid vault id.

**Execution note:** Gate on a standalone testnet smoke (`scripts/pair-smoke.ts`) that runs pair end to end and confirms a real `remember` write succeeds, since passing `loadConfig`/preflight does not imply write-success.

**Patterns to follow:** `scripts/seed.ts` (owner-signed mint → register → `exchangeSuiForWal`), `chain/core/src/funding.ts` thresholds, `chain/mcp/src/config.ts` env contract, `chain/mcp/src/smoke.ts` only as the post-pairing verification harness.

**Test scenarios:**
- Covers AE2. Happy path (testnet smoke): pairing a fresh agent and then running a real `remember` succeeds end to end; the emitted agent clears both `MIN_AGENT_SUI` and `MIN_AGENT_WAL` (not merely parses).
- Edge case (unit): given an already-paired agent key, the command pre-checks the vault and reports "already paired" without submitting a tx.
- Error path (unit/smoke): owner wallet under threshold → actionable message naming the SUI needed; faucet rate-limited → fallback guidance (reuse balance / pre-funded wallet).
- Error path (unit): invalid or nonexistent vault id → the "vault not found on testnet" class of message.
- Edge case (unit): the owner key is never echoed, logged, or accepted as a positional CLI arg.

**Verification:** The owner runs one command, obtains a four-var env that completes a real `remember` against the live vault, and has a documented revoke path; the owner key never appears in logs, shell history, or output.

---

### Phase 3 — Developer track content

### U5. Concept pages: how Anima works

**Goal:** Product-facing explanations of custody, the two-key model, Seal, Walrus, resurrection, and signed attribution.

**Requirements:** R7

**Dependencies:** U1

**Files:**
- Create: `docs/src/content/docs/build/concepts/custody-and-ownership.mdx`, `two-key-model.mdx`, `seal-encryption.mdx`, `walrus-storage.mdx`, `resurrection.mdx`, `signed-attribution.mdx`

**Approach:**
- Write as product explanation ("how it works"), adapting `integration.md` §1/§7, `decisions.md`, and `positioning.md` for accuracy. No internal file paths, no internal status, no mock/partial labels.
- Re-verify each mechanical claim against current `chain/` (the decisions log is dated 2026-06-10): custody Option B, revocation re-consult behavior, cache-after-delete, faucet rate-limiting.
- Respect the honesty ceiling: claim only attribution + signing, wallet-owned blobs sealed to Walrus, revocable access, resurrection, export. No realtime-conflict or latency guarantees.

**Patterns to follow:** `positioning.md` voice and do-not-say list.

**Test scenarios:**
- Happy path: all six pages build, appear under the Build group, and internal links resolve.
- Edge case: no page asserts a capability not present in current `chain/` (accuracy review against `decisions.md` + code).
- Test expectation: content pages are non-behavioral beyond build + link integrity, enforced by U9's checks.

**Verification:** Concept pages render under Build with Anima, links resolve, and every claim matches verified mechanics.

---

### U6. Quickstart and MCP tool reference

**Goal:** A working "connect your agent" quickstart anchored on the pairing command, plus a curated reference for the four live tools.

**Requirements:** R5, R6

**Dependencies:** U1, U4

**Files:**
- Modify: `docs/src/content/docs/build/quickstart.mdx`
- Create: `docs/src/content/docs/build/mcp-reference.mdx`

**Approach:**
- Quickstart: run the pairing command (U4) → get the four env vars → paste the `mcpServers` snippet into Claude Code / Cursor → run anima-mcp → first `recall` and `remember`. Enumerate all four env vars explicitly, conforming to the `chain/mcp/src/config.ts` (`loadConfig`) contract as the single source of truth; never tell the reader to copy the app's snippet.
- Secrecy guardrail: label `ANIMA_OWNER_ADDRESS` and `ANIMA_VAULT_ID` as public on-chain identifiers and `ANIMA_AGENT_KEY` as the one secret. State that the agent key grants full read and write of the whole vault (Seal access is vault-wide, not per-note), must be stored like a password, never committed or pasted into chat, and can be revoked (point to the U4 revoke path). Use obviously fake `suiprivkey…` / `0x…` placeholders, never a real key.
- Reference: document exactly `recall(query)`, `remember(title, body, tags?)`, `list_notes()`, `read_note(noteId)` with inputs, outputs (including the note wire shape), and the caller-visible error contract. `place_note` is not documented (it depends on the unshipped canvas). Curate by hand; do not generate from the registered tool list.
- Also publish the `mcpdoc` pointer snippet (uses the artifact from U3).

**Patterns to follow:** `chain/mcp/src/index.ts` schemas + `chain/mcp/src/tools.ts` outputs for exact I/O; `.mcp.json` placeholder snippet at repo root.

**Test scenarios:**
- Covers AE2. Integration: following the quickstart end to end (pair → env → mcp → recall/remember) succeeds against testnet without reading any internal doc.
- Edge case: the quickstart marks `ANIMA_AGENT_KEY` as secret (full-vault credential) and `ANIMA_OWNER_ADDRESS`/`ANIMA_VAULT_ID` as public, uses fake placeholders, and links the revoke path.
- Edge case: the reference lists exactly four tools; `place_note` is absent (negative assertion against the registered-tool set).
- Happy path: each tool's documented input/output matches the live schema and handler output (recall-empty message, read_note bad-id hint, remember timing note).

**Verification:** A reader completes the connect flow; the reference matches live tool behavior and excludes the roadmap tool.

---

### U7. FAQ / troubleshooting

**Goal:** The real failure cases a developer or agent encounters, with the exact user-facing error each maps to.

**Requirements:** R8

**Dependencies:** U1, U4, U6

**Files:**
- Create: `docs/src/content/docs/build/faq.mdx`

**Approach:**
- Cover, distinctly (do not conflate): missing or invalid env (especially a key that is not a `suiprivkey`); unpaired or revoked key; unfunded agent including the no-WAL-auto-swap case with the SUI/WAL thresholds; faucet per-IP rate-limit and the fallback; vault-not-found; and the three distinct staleness causes — index TTL freshness window, write-through updating only the writer's own cache, and a deleted note briefly served from a stale index — plus process-scoped revocation lag (takes effect on the agent's next process start, not next call).
- Note that the agent key is a full-vault read/write credential (not per-note) and document how to revoke it; and that pairing funds in two steps (owner funds SUI, the agent swaps for WAL), so a SUI-only agent fails its first write until WAL is acquired.
- Reproduce the actual error strings a caller sees so an agent-consumer can pattern-match and self-correct (the dev-track llms-full content inherits these).

**Patterns to follow:** error types and messages in `chain/mcp/src/vaultClient.ts`, `chain/mcp/src/config.ts`, `chain/core/src/funding.ts`.

**Test scenarios:**
- Happy path: each enumerated failure case has an entry naming the trigger and the fix.
- Edge case: the three staleness causes are documented as three separate scenarios with their own bounds, not one "eventual consistency" line.
- Error path: the funding entry states no SUI→WAL auto-swap on the write path and gives the thresholds and manual step.

**Verification:** Every failure case from the connect/use path has a findable, accurate entry.

---

### U10. Self-host Anima guide

**Goal:** A Build-track guide for running a self-hosted Anima instance against your own configuration.

**Requirements:** R17

**Dependencies:** U1

**Files:**
- Create: `docs/src/content/docs/build/self-hosting.mdx`

**Approach:**
- Document the real run path of the components that actually ship as a self-hostable stack: the static frontend build and the stateless Go backend (`backend/Dockerfile`, `EXPOSE 8080`, OpenRouter plus Sui/network config). `chain/service` is empty (cut at plan time); chain interactions run client-side via the anima library and anima-mcp runs user-side, so there is no separate chain-service to deploy. The Move contract is already on-chain; the guide points an instance at it rather than redeploying.
- Offer a Coolify-flavored path (dogfoods the same stack these docs deploy on) alongside plain Docker, since the backend already ships a Dockerfile.
- Lead with the custody framing this reinforces: a self-hosted instance is stateless and your notes stay on Walrus under your wallet, so running your own instance is the strongest form of "not hostage to any app". Keep it product-facing; no internal status labels.
- Honesty gate and scope: document only what is actually runnable. Verify the full env surface against `backend/` before publishing; keep the OpenRouter key in Coolify's secret store or Docker secrets / runtime env, never a committed `.env`. The current frontend is mid-rebuild (the same rebuild the user track waits on), so a self-hosted instance today brings up capability-level UI; the durable value a self-hoster gets now is the wallet + Walrus + anima-mcp path, with full UI parity at the rebuild. Scope the guide to testnet and note the mainnet Seal access caveat (Enoki/permissioned) rather than implying mainnet self-host is turnkey.

**Patterns to follow:** `backend/Dockerfile`, `backend/README.md` (endpoints and env: OpenRouter key, JWT secret, port, network); the `docs/README.md` Coolify notes from U2 for the Coolify path.

**Test scenarios:**
- Happy path: the documented env and run steps match `backend/Dockerfile` + `backend/README.md`; a reader can stand up the backend and frontend pointed at the deployed contract.
- Edge case: the guide states the testnet scope and the mainnet-Seal caveat; it does not claim a turnkey mainnet self-host.
- Error path: each required config item that is missing (OpenRouter key, network, contract/package id) is called out with the symptom a reader sees.

**Verification:** A reader can self-host an instance on testnet following only this page; every config item maps to a real backend setting.

---

### Phase 4 — User track and finish

### U8. User track pages

**Goal:** Getting started plus note how-tos, publishing and export, and the companion, at capability level.

**Requirements:** R10, R11, R12

**Dependencies:** U1

**Files:**
- Modify: `docs/src/content/docs/use/getting-started.mdx`
- Create: `docs/src/content/docs/use/notes.mdx`, `docs/src/content/docs/use/publishing-and-export.mdx`, `docs/src/content/docs/use/companion.mdx`

**Approach:**
- Document capability: capture, search, edit, delete notes; the companion answering with cited notes (a resident built-in agent, not the product); publishing a note (public and password) and exporting the vault as a markdown zip.
- Write at capability level without UI screenshots; the rebuild lands the final UI and screenshots come then (Deferred to Follow-Up Work). No internal status labels.
- Do not link the `/read.html` public reader by default: `shareUrl()` hardcodes it but the current frontend has no `read.html` source, so the URL alone is not evidence a reader exists. Document the share capability (public and password); link a reader only after verifying a live one. For the delete how-to, describe real deletion as wallet-signed via `forgetNotes` / `buildForgetPlan` (custody-accurate framing).

**Patterns to follow:** `chain/core/src/share.ts` (`publishNote`/`shareUrl`), `chain/core/src/exportVault.ts` (`exportVaultZip`), `chain/core/src/quilts.ts` (`forgetNotes`/`buildForgetPlan`/`buildDeleteQuiltsTx`) for accurate capability description; `positioning.md` for the companion framing.

**Test scenarios:**
- Happy path: all user pages build, appear under the Use group, and links resolve.
- Edge case: no page depicts a UI screenshot that does not exist; publishing how-to links a reader path only if one is live.
- Test expectation: content pages are non-behavioral beyond build + link integrity (enforced by U9).

**Verification:** User pages render under Use Anima at capability level, accurate to shipped behavior, with no broken or fabricated UI references.

---

### U9. Landing fork and agent-layer integrity checks

**Goal:** The two-panel fork landing and a runnable check that the agent-readable layer is internally consistent on every build.

**Requirements:** R13, R14, R15, R16

**Dependencies:** U1, U2, U3, U5, U6, U7, U8, U10

**Files:**
- Modify: `docs/src/content/docs/index.mdx` (two-panel fork + short "what is Anima")
- Modify: `docs/astro.config.mjs` (finalize sidebar)
- Create: `docs/scripts/check-agent-layer.ts` (build-time assertions against `docs/dist/`)
- Create: `docs/scripts/check-serving.ts` (post-deploy smoke against the live URL)
- Modify: `docs/package.json` (check script entries)

**Approach:**
- Landing: a splash page with "what is Anima" above a two-panel fork to Use Anima and Build with Anima (model the Linear-style permanent fork). Give each panel a one-line description (Use Anima: "capture notes, ask the companion, publish and export"; Build with Anima: "connect your own agent to a vault via anima-mcp"), cleared against the `positioning.md` do-not-say list.
- Build-time check (against `docs/dist/`, no GitHub Actions): every URL in `llms.txt` resolves to a built page; each page's `.md` is clean markdown (AE4 round-trip); `llms-full.txt` declares its scope. Fail the build on any violation.
- Post-deploy serving smoke (against docs.anima.app, the only place drift is observable): `/llms*.txt` is `text/plain`, per-page `.md` is `text/markdown`/`text/plain` (not octet-stream/attachment), all fetchable with no auth wall, and no `llms.txt` entry 404s. A build-time check cannot see what Coolify served, so deploy-drift detection lives here, not in the build check.

**Patterns to follow:** Astro static endpoints / `getCollection` for the build check; Starlight splash template for the landing.

**Test scenarios:**
- Happy path: the build-time check passes on a clean build.
- Covers AE4. Integration: the build-time check fails if any page's `.md` returns HTML or component noise.
- Error path (build-time): the check fails if an `llms.txt` entry points at a page absent from `docs/dist/`.
- Error path (post-deploy): the serving smoke fails if a deployed `llms.txt` entry 404s (partial-deploy drift), if a `.md` URL returns octet-stream/attachment, or if any artifact sits behind an auth wall.

**Verification:** Landing forks cleanly to both tracks; the agent-layer check passes and would catch llms drift, dirty markdown, or a broken serving contract.

---

## System-Wide Impact

- **Interaction graph:** The docs package is build-isolated from the Vite app and Go backend (confirmed: no workspace; root tsconfig includes only `chain`/`scripts`). The only code reach into the product is U4 at `scripts/pair.ts`, owner-signed admin code over the existing `chain/core` register/fund primitives (it does not modify them). `chain/mcp/src/config.ts` is the single source of truth for the four-var env contract.
- **Error propagation:** The pairing command surfaces actionable errors in the MCP style (no stack traces); FAQ mirrors the real caller-visible strings so agent-consumers self-correct.
- **State lifecycle risks:** U4 funds on-chain agents; minting a fresh key every run would orphan funded agents and drain the owner wallet, so it must accept/reuse a key and pre-check. Coolify Watch Paths must be scoped to `docs/**` so the docs app is not redeployed by every frontend-rebuild commit.
- **API surface parity:** None changed. The Go backend stays internal; anima-mcp remains the only documented external surface.
- **Integration coverage:** The connect flow (U4 → U6) and the agent-layer serving contract (U2/U3 → U9 post-deploy smoke) are the cross-layer paths unit tests alone will not prove; both carry integration scenarios.
- **Unchanged invariants:** `chain/core` and the Move contract are reused as-is; U4 adds an owner-signed admin command on top of existing primitives but changes no chain logic.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Pairing command drifts from the real onboarding path and emits a non-working env (the exact failure the app's mock has today) | Mirror `scripts/seed.ts` (owner-signed register + fund + WAL swap), and gate U4 on a smoke that completes a real `remember`, not merely passing preflight (AE2). |
| Per-page `.md` serializes MDX components to noise, breaking agent consumption | U3/U9 assert a clean-markdown round-trip, not mere existence. |
| Concept/FAQ pages assert mechanics that have since changed (decisions log dated 2026-06-10) | Re-verify each claim against current `chain/` before publishing; positioning.md is the honesty ceiling. |
| Coolify/Traefik fronts the llms files with a content-type or auth that breaks mcpdoc | U2 documents the header contract; U9 asserts it against the deployed URL. |
| Publishing how-to links a reader page the rebuilt frontend no longer serves | Verify `/read.html` against the live frontend at impl; document capability regardless and link a reader only if present. |
| User-track pages go stale when the frontend rebuild lands | v1 ships capability-level, no screenshots; screenshot pass is explicit Deferred to Follow-Up Work tied to the rebuild plan. |
| Self-host guide documents config that does not fully stand up an instance | Verify every env item against `backend/` before publishing (chain/service is empty/cut); scope the guide to testnet; note the current frontend is mid-rebuild so the running UI is capability-level; flag the mainnet Seal access caveat. |
| U4 emits an agent that connects but cannot write (SUI-only funding; the write path needs WAL and never self-heals) | Fund SUI above the swap floor and run an agent-signed `exchangeSuiForWal` during pairing; gate U4 on a smoke that completes a real `remember`, not just env-parse. |
| Owner key leak (can register attacker agents on any vault and drain the wallet) | Load the owner key from a gitignored file or stdin, never a CLI arg or log; docs warn never to paste it. |
| The minted `ANIMA_AGENT_KEY` is a full-vault credential with no kill switch | Ship a revoke path (U4, reuse `buildRevokeAgentTx`) and a docs guardrail (store like a password, per-agent not per-note, revocable). |
| Mint-every-run drains the owner wallet and bloats the on-chain allowlist | Accept/reuse an optional agent key and pre-check the vault before submitting. |
| Coolify redeploys the docs app on every commit to the shared branch | Scope Coolify Watch Paths to `docs/**` (U2). |
| The build-time integrity check cannot observe deploy drift | Split U9 into a build-time check (`docs/dist`) and a post-deploy serving smoke (live URL). |

---

## Documentation / Operational Notes

- Coolify setup is configuration, captured in `docs/README.md` for the maintainer; it is not codified beyond `nixpacks.toml`.
- After the site lands, the Coolify/Nixpacks/Starlight build gotchas are a strong candidate to capture in `docs/decisions.md` (the repo has no `docs/solutions/` tree).
- The agent-authored Walrus-Site dogfood (origin R17/F4) remains the v2 milestone; revisit once the Walrus Site publish flow is wired.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-20-docs-site-requirements.md`
- Brand/voice and honesty ceiling: `docs/positioning.md`
- Verified mechanics: `docs/decisions.md`, `docs/integration.md`
- Code: `chain/mcp/src/{index,tools,vaultClient,config,smoke}.ts`, `chain/core/src/{vault,funding,share,exportVault,quilts,notes,types}.ts`
- Related plan: `docs/plans/2026-06-10-002-feat-mocked-frontend-rebuild-plan.md` (frontend rebuild; user-track screenshot dependency)
- External: Starlight (starlight.astro.build), starlight-llms-txt (delucis.github.io/starlight-llms-txt), mcpdoc (github.com/langchain-ai/mcpdoc)
