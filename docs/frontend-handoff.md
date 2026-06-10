# Frontend Handoff

> The brand-kit agent builds every page below, **web3-free** (mock the data).
> Integration to the chain layer happens AFTER, on the integrator's side —
> the working logic already exists and is tested. Updated 2026-06-10.
>
> Reference implementation of every page (working, ugly): `git checkout reference-frontend -- frontend/src`

## What the brand-kit agent builds

1. **Landing page** — pitch + connect entry (no chain data needed).
2. **Onboarding modal** — name companion → "create" → progress states (creating → preparing → done). One ceremony.
3. **Session states** — checking spinner · "pair this device" (one button) · **waking/rebuild progress** ("decrypting memory, quilt N of M" — a hero moment, not a loader).
4. **Workspace shell** — header (companion name, memory count, owner short-address, tabs: companion / canvas / vault, settings entry, connect button).
5. **Chat (companion)** — message list, streaming text, **citation chips** inside assistant text (chip → opens note panel), input bar, ephemeral-transcript caption, error/low-balance banners, **write-state cards** with 4 states: `encrypting → certifying → certified (provenance link) | failed (+retry)`.
6. **Vault list** — search, tag filters, note rows (title/preview/meta), designed **empty state**, forget-select mode + forget confirmation dialog (enumerates exactly what dies → wallet confirm), export button.
7. **Note panel/slide-over** — read view (markdown), edit mode (→ "save as new version"), tags, backlinks list, explorer provenance link, **share button**.
8. **Share dialog** — mode pick (🌐 public article / 🔒 password link), publish progress (~15s), link + copy state, published-copies list with unpublish.
9. **Canvas (constellation)** — draggable memory cards, link edges, **peer cursors with labels** (human + agent variants, "is writing…" state), materialize animation for new notes, "saving layout…" indicator, pan (+zoom if desired), empty state.
10. **Settings** — agents & devices (list keys, this-device marker, REVOKE, "connect external agent" flow: generate → secret shown ONCE → register → MCP env block + copy), balances + top-up prompt, export vault, danger-zone styling.
11. **echo** (separate entry `alt.html`) — distinct accent/brand, found-soul screen, "bring it back" (one button), waking rebuild, then the same workspace; companion speaks FIRST.
12. **Public reader** (separate entry `read.html`) — Medium-style article: title/author/date/tags, rendered markdown, password-unlock state (decrypts in browser), "stored on Walrus" footer + raw blob link. NO wallet, NO providers.

## IA decisions (user-confirmed 2026-06-10)

- **Onboarding = one modal ceremony**: connect → name companion → PTB signature
  → auth message signature chained in the same gesture (silent WAL swap behind a
  "preparing…" state). Two signatures total, once ever.
- **Login**: autoConnect; JWT re-auth = one message signature when expired;
  fresh device = one-button "pair this device" modal.
- **Settings holds standing state**: agents & devices (pair/REVOKE), balances +
  top-up, export vault, danger-zone copy. **Forget stays contextual** (select
  memories in vault/note views → enumerate → wallet confirm); **unpublish stays
  on the note's share panel**. Rule: destructive = wallet signature = shared
  "danger" visual language, wherever it appears.

## Integration layer (KEPT, compiled, tested — the integrator wires it in later)

Mock these shapes while building; do not reimplement them:

- `frontend/src/lib/useVaultSession.ts` → `{phase}` state machine: `disconnected | checking | first-run | needs-pairing | rebuilding{done,total} | ready{vault, agent, index}`
- `frontend/src/chat/useChatStream.ts` → `stream(args, onDelta)`, `distill(transcript)`, `streaming`
- `frontend/src/chat/useMemoryLoop.ts` → `pending: PendingNote[]` (the 4 write states), `remember(exchange)`, `retry()`, `lowBalance`
- `frontend/src/canvas/useCanvasSync.ts` → `peers{id,label,kind,x,y,writing}`, `layout{noteId:{x,y}}`, `moveNote`, `sendCursor`, `savingLayout`
- `frontend/src/lib/{agentKey,chain,backendAuth}.ts` + `app/providers.tsx` — wallet/chain/JWT wiring
- `chain/core` — everything chain-shaped (notes, index/search, vault PTBs, forget plan, share/publish, export, canvas layout)
- Note entry shape: `{note: {noteId, version, updatedAt, author, tags[], links[], title, body}, location: {blobObjectId,…}}`

## Non-negotiables for any skin (the pitch depends on them)

1. Write-state visibility (encrypting→certifying→certified+provenance link) — judges probe it.
2. Wallet-gate ONLY on destructive ops (forget/revoke/unpublish) — celebrate the asymmetry in copy.
3. Ephemeral-transcript label; "owned by your wallet" custody line; explorer links stay.
4. Empty states designed (vault, canvas, reader 404).
5. One living element (orb/presence pulse) — the companion has a body.
