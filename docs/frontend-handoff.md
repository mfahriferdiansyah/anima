# Frontend Handoff — build the skin web3-free, I wire the chain in

> Contract for the design/frontend agent. Build every page as pure UI against
> these props/callbacks (mock them freely). Integration = me swapping mocks
> for the REAL hooks below — zero logic to reinvent. Updated 2026-06-10.

## The split

**KEEP (working, tested, do not rebuild):**
- `chain/core/**` — all chain logic (notes, quilts, Seal, index, vault PTBs, funding, canvas, share, export)
- `frontend/src/lib/` — `agentKey.ts` (IndexedDB keypair), `chain.ts` (client singletons, rebuild), `backendAuth.ts` (nonce→JWT), `useVaultSession.ts` (the session brain)
- `frontend/src/chat/useChatStream.ts`, `useMemoryLoop.ts` — streaming + the memory loop
- `frontend/src/canvas/useCanvasSync.ts` — multiplayer state
- `backend/**`, `chain/mcp/**`, `contract/**`, `scripts/**`

**REPLACE (visual shells — current files are reference implementations):**
Onboarding.tsx · App.tsx routing · Workspace.tsx · Chat.tsx (view part) ·
NoteToast.tsx · VaultPane.tsx · NoteSlideOver.tsx · ForgetDialog.tsx ·
AgentsModal.tsx · ShareDialog.tsx · CanvasView.tsx · AltApp.tsx · reader/main.tsx ·
theme/tokens.css (→ the ink/pink/teal kit)

## Page inventory & the data each receives

### 1. Landing (NEW — design-led, no chain data)
Pitch + ConnectButton entry. Optional live stat (memories count) can come later.

### 2. Session router (`useVaultSession(ns)` drives everything)
Phases → screens: `disconnected` (hero+connect) · `checking` (spinner) ·
`first-run` (onboarding) · `needs-pairing` (one-button pair, 1 wallet tx) ·
`rebuilding` ({done,total} progress — the "waking" moment) · `ready` (workspace).

### 3. Onboarding
Inputs: companion name. Actions: `buildOnboardingTx({name, firstAgent, fundAgentMist})`
→ wallet signs ONE PTB → agent self-swaps WAL silently. States: balance guard
(copy committed in plan), creating, funding, done. Honest popup count: 1 PTB +
1 auth personal-message, once ever.

### 4. Chat (companion)
- `useChatStream({getJwt, model})` → `stream(args, onDelta)`, `distill(transcript)`, `streaming`
- `useMemoryLoop({ns, vault, agent, index, distill})` → `pending[]` (NoteToast states:
  `encrypting | certifying | certified(blobObjectId) | failed(+retry())`), `remember(exchange)`, `lowBalance`
- Citations: assistant text contains `[[noteId]]` → chips → open note (slide-over/panel — kit's call)
- Transcript is EPHEMERAL (label it). First-chat greeting (empty vault) + wake greeting
  (`wakePrompt` prop — echo's unprompted first message citing a memory).
- ChatHandle.scrubFromTranscript(titles) — called by forget (edge #3).

### 5. Vault (list view)
`index.all()` / `index.search(q, topK)` / tags. Entry: `{note: {noteId, version,
updatedAt, author, tags, links, title, body}, location: {blobObjectId, …}}`.
Actions: open, edit (`editedNote` + `writeTurn` — see NoteSlideOver ref), forget
(select → `buildForgetPlan` → silent survivors `writeTurn` → ONE wallet PTB
`buildDeleteQuiltsTx` → `index.remove` + transcript scrub), export (`exportVaultZip`),
designed EMPTY state. Explorer links: `https://testnet.suivision.xyz/object/<blobObjectId>`.

### 6. Canvas (constellation)
`useCanvasSync({ns, vault, agent, index, selfLabel, onNewNotes})` →
`peers` (id/label/kind human|agent/x/y/writing) · `layout` {noteId:{x,y}} ·
`moveNote(id,x,y)` (debounced chain save) · `sendCursor(x,y)` (throttle ~30fps,
CANVAS coords) · `savingLayout`. Notes = `index.all()` minus `LAYOUT_TAG` tag.
New notes via `onNewNotes` → materialize animation. Edges from `note.links`.

### 7. Agents & devices
`vault.agents[]`; revoke = `buildRevokeAgentTx` (1 wallet tx); pair-external =
generate `Ed25519Keypair`, show secret ONCE (never persisted by us),
`buildRegisterAgentTx({…, fundAgentMist})`, then show MCP env block
(ANIMA_AGENT_KEY/VAULT_ID/OWNER_ADDRESS/AGENT_NAME [+ ANIMA_PRESENCE_URL]).

### 8. Share dialog + Reader page
`publishNote(deps, note, {password?})` → `{blobId, url, mode}`;
`listPublished(deps, noteId?)`; unpublish = `buildDeleteQuiltsTx` (wallet).
Reader (`/read.html?b=<blobId>`): NO wallet/providers — fetch
`aggregatorUrl(blobId)`, `isPasswordShare(bytes)` ? prompt+`openWithPassword`
: `parseNote` → article layout (title/author/date/markdown via `marked`).

### 9. echo (alt entry, resurrection)
Same session phases under ns='alt' + different accent + `model` (OpenRouter
string) + `wakePrompt`. Beats: found-soul screen → register-body (1 tx) →
waking rebuild progress → wake greeting. Storage is namespaced — do NOT share
state with the main app.

## Mocking guide (build web3-free)
Every hook's return shape is plain data — mock with fixtures:
- session: `{phase:'ready', vault:{vaultId:'0x…', owner:'0x…', name:'Anima', agents:[…]}, agent:{}, index}`
- index: `VaultIndex.fromEntries(fixtures)` works headless (pure TS, no chain)
- pending toasts: cycle the 4 states on a timer
- peers: 2-3 fake peers with sin/cos cursor motion; one `kind:'agent'`, `writing:true`
Then integration = me replacing fixture imports with the real hooks (≈ a day).

## Non-negotiables for any skin (the pitch depends on them)
1. Write-state visibility (encrypting→certifying→certified+provenance link) — judges probe it.
2. Wallet-gate ONLY on destructive ops (forget/revoke/unpublish) — celebrate the asymmetry in copy.
3. Ephemeral-transcript label; "owned by your wallet" custody line; explorer links stay.
4. Empty states designed (vault, canvas, reader 404).
5. The one living element (orb/presence pulse) survives the restyle.
