# ANIMA Integration + Tier-2 Build Plan (ambitious path)

> The user chose to build the REAL versions of the invented features, flagging
> infeasible ones. This is the synthesized, dependency-sequenced plan from a
> 10-architect design pass (designs in the run transcript). Produced 2026-06-21.
> Companion: `docs/integration-gap-report.md` (what's mocked vs real).

## Verdict up front

- **One gate blocks everything: the browser web3 layer (Foundation).** ~3–4 days, medium risk. Its risk is *not* logic (the Node `e2e-chat.ts` proves the whole loop) — it's the **unproven browser network surface** (CORS to the upload relay + 4 Seal key servers + aggregator, and WASM bundling under Vite). So Foundation's **first deliverable is a one-quilt browser read+decrypt smoke test** against the seeded vault — we learn on day 1, not at integration. Dev-signer fallback exists if a wallet/CORS issue hits late.
- **ZERO contract redeploys recommended.** Only `rename` needs a Move change, and its no-redeploy fallback (a reserved `anima:companion-label` note) is honest and resurrection-safe. Taking it means **no republish → no Seal re-pin → no demo re-seed → no agent re-pairing.** Everything else (folders, covers, multi-canvas, forget, pairing, calendar, suggestions) is designed to avoid the contract entirely via the reserved-note pattern.
- **Two features are cut regardless** (infeasible/identity-breaking): the share **"edit / multiplayer link"** and **backend-OAuth Google Calendar**. See the bottom section.
- **Full ambitious build ≈ 30–40 engineer-days.** It does not all fit a near-term hard wall. The cut-line below is ordered so the demo is whole at every stopping point.

## The build order (dependency-sequenced)

### Phase 0 — Foundation (the gate; build first, unconditional)
The `useVaultDeps` context is the centerpiece every hook consumes: `{suiClient, seal, agentSigner, walletAddress, vaultId, jwt}` + `localAgentKeyExists`.
- `web3/AnimaProviders.tsx` — QueryClient ▸ SuiClientProvider(`createClient`→core `createSuiClient({wasmUrl})`) ▸ WalletProvider autoConnect; wasm via `@mysten/walrus-wasm/web/...?url`
- `web3/browserSmoke.ts` — **FIRST**: connect→auth→discoverVault→read one quilt→decrypt; proves CORS/WASM/key-servers
- `web3/auth.ts` — nonce→`signPersonalMessage`→verify→JWT (idb-cached per owner; StrictMode once-latch)
- `web3/agentKey.ts` — browser Ed25519 keypair in IndexedDB keyed by owner (`hasAgentKey` drives first-run vs needs-pairing)
- `web3/walletExecTx.ts` — dapp-kit signer adapter with the **`execute` override forcing `showObjectChanges`** (default returns rawEffects only — confirmed gotcha; `vaultIdFromCreateResult` breaks without it)
- `web3/VaultDeps.tsx` — the shared context

### Phase 1 — Core loop (Tier-1, all wire-only on Foundation) — *settled, build*
Swap each `mocks/*Store.ts` for a real hook, same signatures, no page edits:
session/onboarding/resurrection · notes read/edit/save + real write-states · search/wikilinks/backlinks · chat (SSE + `[[id]]`→`citations[]` extract + distill→writeTurn) · per-note forget · **single shared canvas** (loadLayout/saveLayout + real presence WS) · settings revoke/balances/export · publish. **Land reserved-tag hygiene here** (`isReservedNote`/`VaultIndex.notes()`) — cheap, and fixes a real latent leak where the layout note shows up in recall.

### Phase 2 — Tier-2 GREEN (low risk, high value; build for real)
| Feature | Effort | Why green | Redeploy |
|---|---|---|---|
| **Persisted folders** | 1.5–2d | reserved `anima:folders` note (order+empties) + the leak fix; membership stays `tags[0]` | none |
| **Covers (preset)** | ~0.5d | one optional `cover:` frontmatter line; additive, no rework for uploads later | none |
| **Forget-everything** | 1.5–2d | thin orchestration over existing `listVaultQuilts`+`buildDeleteQuiltsTx` (no survivors path); skip vault teardown | none |
| **Public reader + share-copy rewrite** | ~3d | recover the deleted reader; extract `share-crypto.ts` leaf (no SDK in the public page); ShareDialog → publish-read-only (drop edit-link) | none |

### Phase 3 — Tier-2 AMBER (bigger, build with eyes open)
| Feature | Effort | Note | Redeploy |
|---|---|---|---|
| **Multi-canvas system** | 5–7d | canvas-registry note + per-canvas layout notes (`anima:canvas:<id>`) + presence rooms keyed `vault\|canvas` + canvas-aware `place_note`. Biggest build. Punt uploaded canvas covers + persisted drawings. | none |
| **Corrected pairing + agent registry** | 2–3d | **the current dialog is backwards** (app mints secret) → flip to address-registration (the real custody beat); `anima:agent-registry` note for labels (cuttable) | none |
| **Home deterministic (plans + milestones)** | ~3d of the 5–7 | `scanPlans` (dates from your own notes) + `scanMilestones` (from VaultCreated/listPublished/resurrection) — real, cheap, no LLM | none |

### Phase 4 — Tier-2 STRETCH (only if time)
- **Cover uploads** (+1–1.5d): separate plaintext Walrus blob + `blob:<id>` ref (flagged: covers are public, not Sealed)
- **`/suggest` LLM loop** (+~2d): stateless backend endpoint mirroring `/distill`; the prose "Nova suggests" prep tasks
- **Google Calendar — browser OAuth only** (+4–6d, external schedule risk = Google consent screen): GIS token client in the SPA (tokens never leave the client) + a `read_calendar` MCP tool. **Never** backend OAuth.

### Phase 5 — Deferred unless a redeploy happens anyway
`set_name` (rename real), `delete_vault` (forget teardown), `AgentRegistered` event (paired-date milestone). Each is cheap *code* but forces the redeploy cascade — batch them only if one becomes unavoidable. **Default: none; take the fallbacks.**

## Per-feature recommendation summary

| Feature | Recommendation |
|---|---|
| Foundation | **BUILD** (gate; smoke-test day 1) |
| Tier-1 core loop | **BUILD** (settled) |
| Folders | **BUILD real** (reserved note) |
| Covers | **BUILD preset now**, uploads = stretch |
| Forget-everything | **BUILD real** (no teardown) |
| Public reader | **BUILD real** (recover + isolate bundle) |
| Multi-canvas | **BUILD real** (registry; drop drawings/uploaded covers) |
| Pairing + agent labels | **BUILD corrected dialog**; labels-note = cuttable |
| Home plans + milestones | **BUILD deterministic**; `/suggest` LLM = stretch |
| Rename | **FALLBACK** (label note; avoid redeploy) |
| Share edit-link | **CUT** (infeasible) |
| Google Calendar | **DERIVED layers real; GCal browser-OAuth stretch; backend-OAuth NEVER** |

## The two hard cuts (infeasible / identity-breaking)

1. **Share "edit / multiplayer link"** — implies anonymous *write* into a vault you don't own + real-time collab + a server-side grant store, none of which exist; Seal also gates decryption for any non-allowlisted reader. That's a multi-week collaborative-editing subsystem and it breaks the stateless backend. **Drop the "Can edit" card; ship publish-read-only + the reader.**
2. **Backend-OAuth Google Calendar** — storing OAuth refresh tokens server-side needs a DB + secrets-at-rest + logging the chat package explicitly forbids; it contradicts the "stateless, holds nothing" custody thesis that is the whole pitch. **If GCal ships at all, it's browser-only OAuth (client-held token) + an MCP tool — never the backend.**

## Critical engineering notes carried from the designs
- **dapp-kit `execute` override** for `showObjectChanges` (else onboarding/pairing result parsing breaks).
- **wasm `?url` import** is mandatory in-browser (silent encode/read failure if omitted).
- **Two signers, never conflated:** wallet (destructive + onboarding/pairing) vs browser agent key (silent writes + Seal session).
- **Reserved-note pattern** (`anima:*` tags) is the sanctioned home for all new durable app-state; **reserved-tag hygiene** must filter them from recall/library.
- **Bundle isolation** for the reader: split pure crypto/url helpers into `share-crypto.ts` so the wallet-free page never imports the Sui/Seal/Walrus SDK.
