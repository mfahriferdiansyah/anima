# ANIMA Integration Surface (ground truth for the design kit)

> For the design/frontend agent. Everything here is BUILT and testnet-verified
> unless marked **[planned]**. The UI kit can swap every visual; these are the
> data contracts and flows underneath. Updated 2026-06-10.

## 1. The mental model

One vault per wallet. Memory = markdown notes (frontmatter: noteId, version,
updatedAt, author, tags, links), Seal-encrypted, stored in Walrus quilts whose
Blob objects are OWNED BY THE USER'S WALLET. Everything else — index, canvas
layout cache, JWT — is disposable local state, rebuildable from chain.

Actors writing to one vault: the owner (human), `anima` (the companion),
`claude-code`/any paired external agent (via anima-mcp), `echo` (resurrection
client). Multiplayer = many writers, one chain-synced document.

## 2. Surfaces & session phases (what each screen receives)

`useVaultSession(ns)` drives the app. Phases the UI must render:

| Phase | Data available | Screen |
|---|---|---|
| `disconnected` | — | hero + ConnectButton |
| `checking` | — | spinner |
| `first-run` | wallet address | Onboarding (name → ONE PTB) |
| `needs-pairing` | `vault`, this device's `agent` | "pair this device" (1 tx) |
| `rebuilding` | `vault`, progress (done/total quilts) | the waking spinner ("decrypting quilt N of M") |
| `ready` | `vault {vaultId, owner, name, agents[]}`, `agent` keypair, `index` | Workspace |

Workspace children & their props (current components are placeholders for the kit):
- **Chat** — messages, streaming text, citation chips `[[noteId]]` → opens NoteSlideOver; NoteToast write-states: `encrypting → certifying → certified(blobObjectId) | failed(+retry)`; banners: connection error, low balance.
- **VaultPane** — `index.all()` entries, search/tags, forget-select mode, export; designed empty state.
- **NoteSlideOver** — one note (read/edit→new version), backlinks, explorer link.
- **AgentsModal** — `vault.agents[]`, revoke (1 tx), pair-external flow (generate key → show ONCE → register+fund 1 tx → MCP env block).
- **echo (alt entry)** — same phases, ember accent, wake greeting (LLM, cites a memory).
- **[planned] Canvas/Constellation** — see §6.

## 3. Backend API (Go, stateless — holds NO keys, NO storage)

Base URL: `VITE_BACKEND_URL` (dev http://localhost:8080).

- `GET /auth/nonce` → `{nonce}` (timestamp-windowed, 60s validity)
- `POST /auth/verify {address, nonce, signature}` → `{token, exp}` — wallet personal-message sig (ed25519 wallets, v1); JWT 24h
- `POST /chat {model?, persona, transcript[], context[]}` + Bearer → SSE: `data:{delta}` … `event: done` / `event: error`. Context notes are client-decrypted; persona instructs `[[noteId]]` citations.
- `POST /distill {transcript[]}` + Bearer → `{notes: [{title, body, tags[], links[]}]}` (empty = normal)
- Rate limit 30/min/subject → 429 + Retry-After. CORS: exact allowlist.
- **[planned] `GET /presence?vault=<id>` WebSocket** — ephemeral room relay: join/leave, cursor `{x,y}`, label, "writing" pings. Zero persistence (custody invariant).

## 4. anima-mcp (external agents — Claude Code, Cursor…)

stdio MCP server (`chain/mcp`), committed `.mcp.json` (placeholders only).
Env: `ANIMA_AGENT_KEY` (its own keypair — generated & shown ONCE in AgentsModal),
`ANIMA_VAULT_ID`, `ANIMA_OWNER_ADDRESS`, `ANIMA_AGENT_NAME` (→ note author).

Tools (live): `recall(query)` · `remember(title, body, tags?)` · `list_notes()` · `read_note(noteId)`
— unpaired/unfunded keys get actionable errors, never stack traces.
**[planned]**: `place_note(noteId, x, y)` (writes the canvas-layout note) + WS presence ping so the agent appears on canvas.
**[planned] Claude Code skill** (`anima` skill): teaches Claude when/how to use the tools ("remember this", "what do I know about…").

## 5. Core flows (as built)

- **F0 onboard**: connect → guards (copy committed) → name → ONE PTB (create_vault(name, firstAgent) + fund agent) → agent self-swaps WAL silently → greeting.
- **F1 chat loop**: send → local-index recall (instant) → SSE reply w/ citations → distill → one quilt per turn → blob transferred to wallet → NoteToast states → write-through index.
- **F2 vault**: search/edit (new version, optimistic AE2) / forget (enumerate → survivors-rewrite silently → ONE wallet PTB deletes quilts → transcript scrub).
- **F4 external agent**: AgentsModal pairing → Claude Code recall/remember, author-attributed.
- **F5 resurrection (echo)**: wallet-only cold start → discover vault (VaultCreated event) → register body (1 tx) → rebuild w/ progress → unprompted wake greeting citing a memory. Revoke (AgentsModal) → revoked client's next session refused.

## 6. [planned] Canvas / Constellation — multiplayer between humans & agents

Decisions (engineering-final, visuals open):
- **Custom light canvas** (pan/zoom/drag note cards, link edges) — NOT embedded Excalidraw; the kit owns every pixel.
- **Durable layout** = one reserved note (`tags: [anima:canvas-layout]`, body = JSON `{noteId: {x,y}, …}`), debounce-saved as a new version. Survives resurrection — echo wakes with the constellation intact.
- **Ephemeral presence** = backend WS room per vaultId: cursors, labels, "X is writing", note-created pings. Nothing stored, ever.
- **Freshness**: WS ping triggers index refresh; fallback poll (~20s) when canvas open. New notes materialize with author attribution (agent cursor).
- Agents participate via the SAME vault writes (remember/place_note) + WS presence — no special agent path; humans and agents are peers on the canvas.

## 6b. Sharing & publishing (BUILT)

- **Publish as article** (`publishNote`): a chosen note becomes a standalone
  Walrus blob — `public` (plaintext) or `password` (AES-GCM, PBKDF2-derived
  key; decrypts in the READER'S browser, password never transmitted).
- **Reader** (`/read.html?b=<blobId>[&locked=1]`): wallet-free, provider-free
  article page (Medium-style) fetching straight from the public aggregator.
  Public shares also work as raw aggregator URLs without anima at all.
- **Registry = the chain**: published copies are wallet-owned blobs with
  `app: anima-pub` attributes (`listPublished`); **unpublish = wallet-signed
  delete** (the custody asymmetry, again).
- Surfaces: `ShareDialog` (from NoteSlideOver "share"). Design-kit needs:
  mode picker, link+copy state, published-copies list, the reader page.
- NOT built (post-hackathon, by design): per-note Seal grants / read-only
  vault invites — would trade away the one-identity-per-vault latency win.
  Full-vault member invite = the agents pairing flow.

## 7. Custody invariants the UI must respect (the pitch depends on these)

1. Plaintext at rest + keys exist ONLY client-side (browser IndexedDB / MCP env). Backend transiently sees chat context during inference (say it honestly), stores nothing.
2. Every memory blob is wallet-owned on-chain; provenance links go to the explorer.
3. Routine writes are silent (agent key); DESTRUCTIVE actions (forget, revoke) require a wallet signature — copy should celebrate this asymmetry.
4. Presence/cursors are ephemeral; the canvas layout is the only canvas state that persists, and it persists as a NOTE (same custody as everything).
5. Transcript is ephemeral by design — label it ("only distilled memories persist").

## 8. Theme handoff note

Current `frontend/src/theme/tokens.css` (dark, violet→cyan orb) is a placeholder
awaiting the kit (ink/pink/teal, Space Grotesk — `anima-components.html`).
Components consume CSS vars — restyle by replacing tokens + per-component skins.
The ONE living element (orb/presence pulse) should survive any restyle.
