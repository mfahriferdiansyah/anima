# ANIMA Integration Gap Report

> What the brand-built frontend expects vs. what the real system provides, mapped
> per feature by a 10-agent read of `frontend/src` against `chain/core`, `backend`,
> `chain/mcp`, and `contract/`. Produced 2026-06-21. Severity legend:
> **ready** (pure wiring) · **wire-only** (adapter, no new logic) · **needs-build**
> (new backend/chain/contract code) · **needs-research** (a product decision first).

## The one truth that frames everything

The frontend is a **complete app built on a uniform mock seam**. Every page imports
only from `hooks/use*.ts`; every hook wraps one `mocks/*Store.ts` via
`useSyncExternalStore`. There is **zero web3 in `frontend/src`** today — no
`@mysten/*` imports, no dapp-kit, no wallet connect, no `fetch`, no IndexedDB. The
old `lib/{agentKey,chain,backendAuth}` were removed in the rebuild.

**Therefore integration = reimplement each hook against `chain/core` + the Go
backend, keeping the export names, signatures, and snapshot shapes identical.**
No page rewrites. Delete each `mocks/*Store.ts` as its hook migrates. There is no
mock→real flag to flip; the seam is per-hook.

## Architecture-fit: the big risk was a FALSE ALARM ✅

The thing I flagged as the #1 danger — "does the frontend assume many vaults?" — **does not happen.** The app is single-vault, single-`/app`, no workspace switcher, account chip assumes one `vault.owner`. That is **exactly** the chain model (one shared `Vault` per wallet, `discoverVault` returns the newest). Several other contracts also match 1:1:

- Note shape == chain `Note` (8/8 fields; only `image` cover is extra)
- Canvas layout map `Record<noteId,{x,y}>` == chain `CanvasLayout` **byte-for-byte**
- Presence wire format == chain `PresenceMsg`
- The 6-phase session union == what we built/documented
- Chat streaming + `[[noteId]]` citations + the 4 write-states == backend + `writeTurn`; `scripts/e2e-chat.ts` is a ready React port reference

---

## TIER 0 — Foundation (one build; everything else is blocked on it)

**The browser web3 layer does not exist yet.** This is the single largest item and the prerequisite for every wire-only task below.

- dapp-kit provider tree in `main.tsx` (`SuiClientProvider` + `WalletProvider` + `QueryClientProvider`)
- wallet connect + the auth handshake: `GET /auth/nonce` → `signPersonalMessage` → `POST /auth/verify` → hold JWT for `/chat` + `/distill`
- browser **agent keypair** generated + persisted in IndexedDB (`idb-keyval`), address derived from it
- in-browser `SuiClient` + `SealVault` instantiation (the wallet stack the deps already ship)

Backend, contract, and core are **done and testnet-proven** — Foundation is all client glue. Confirm dapp-kit is the intended wallet stack before building it.

---

## TIER 1 — Core loop (real product; wire-only on top of Foundation)

These are the demo beats. Every primitive exists; the work is adapters + the async/wallet UX the mocks fake.

| Feature | Detail points | Severity |
|---|---|---|
| **Session / onboarding / resurrection** | phase decision from `discoverVault`+agent-key-check (not `?scenario=`); `completeOnboarding`→`buildOnboardingTx` (one PTB); `pair()`→`buildRegisterAgentTx`; rebuild ticks from `readAll`/Seal loop; delete `useScenario`/MockedBadge | wire-only (on Foundation) |
| **Notes: read/edit/save** | `IndexedNote`→mock `Note` adapter; mint ULID client-side at create (routing needs it before async seal); `saveNote`→`editedNote`+`writeTurn`; write-states sourced from the real `writeTurn` promise (not setTimeout) | wire-only |
| **Search / wikilinks / backlinks / recents** | `VaultIndex.search/all/backlinks` already exceed the title-only UI filter | wire-only |
| **Companion chat** | new SSE fetch-reader → append deltas; extract `[[id]]` markers into the `citations[]` the UI reads; `distill`→`newNote`→`writeTurn`→`index.upsert` ported into the hook | wire-only (+ Foundation auth) |
| **Forget (per-note)** | `buildForgetPlan`→survivors-rewrite→ONE wallet PTB `buildDeleteQuiltsTx`→`index.remove`; bridge sync→async + wallet popup; emits transcript-scrub line | wire-only |
| **Canvas — the single shared board** | `loadLayout`/`saveLayout` (debounced `moveNote`); **open the real `/presence` WS** (hub + MCP client exist; browser client is the only missing piece); `note-created`→`syncNewQuilts` materialize | wire-only |
| **Settings: revoke + balances + export** | `buildRevokeAgentTx`; `funding.preflight`/`walBalance` (MIST→SUI, FROST→WAL) for the agent address; export uses already-decrypted notes (`exportVaultZip`) | wire-only |
| **Publish (public / password)** | `publishNote` (public or AES-GCM); `listPublished` chain-as-registry; map `PublishedShare`→UI; unpublish = wallet delete | wire-only (see Tier-2 caveats) |

---

## TIER 2 — Invented scope (needs-build or a product decision)

The "new things" you sensed. Each is a feature the frontend designed beyond what the chain backs. **Each needs your call**, because most have a cheap "ship it honest" path and an expensive "build it real" path.

1. **Multiple canvases per wallet** — *the biggest one.* `CanvasHome` gallery, `createCanvas`, per-canvas boards/covers/desc, canvas folders, canvas sharing. Chain has **exactly one** canvas (one layout note), presence rooms keyed by vault. → **Decide:** collapse UI to the single shared constellation *(ships now)* **or** build a canvas-registry note + per-canvas layout notes + vault+canvas presence rooms *(real work, deadline risk)*.

2. **Folders (order + empty folders)** — `foldersStore` persists an ordered list incl. empty folders. Chain has only tags; folder=`tags[0]` covers membership but not order/empties, and collides with reserved tags (`anima:canvas-layout`). → **Decide:** reserved `anima:folders` note *(small build, survives resurrection)* **or** ephemeral per-device **or** tag-derived only.

3. **Cover images** (notes + canvases) — `note.image`/`CanvasDoc.image`: preset path or uploaded data URL. No frontmatter field. Uploaded data URLs would bloat every encrypted quilt. → **Decide:** preset-paths-only *(cheap, store short string)* **or** a real image-blob upload path *(build)*.

4. **Rename companion (no signature)** — `vault.move` sets `name` only at `create_vault`; there is **no** `set_name` entry fn. The mock renames with no wallet popup. → **Decide:** treat name as a local display label **or** add an owner-only Move entry + **redeploy** (and drop the "no signature" promise — any on-chain mutation must be signed).

5. **Share access model + reader** — UI has an *edit (multiplayer) / view (read-only)* link with `anima.app/s/<slug>` URLs. Chain share is **publish-a-read-only-copy** (`/read.html?b=<blobId>`), no edit-link concept, no slug resolver, and **the wallet-free reader page was dropped** (must be rebuilt). → **Decide:** drop the "Can edit" card, adopt the real `/read.html?b=` URL, rebuild the reader page as a route/entry.

6. **Forget everything (vault-wide wipe)** — only per-note forget exists; no bulk wipe, no vault teardown (`destroy_for_testing` only). → **Decide:** enumerate-all-quilts delete in one PTB *(build)* **or** keep Danger-Zone disabled for the demo.

7. **Home calendar + Google Calendar + "Nova suggests/plans"** — entirely hardcoded June-2026 fixtures. **GCal integration exists nowhere**; the agent-suggestion loop exists nowhere. → **Decide:** build *(large; GCal OAuth + an agent loop)*, keep static for the video, or cut.

8. **Settings agent metadata + pairing direction** — UI shows label / device-vs-external / addedAt / thisDevice / `secretIssued` and *mints* an `anima_sk_` secret in-app. Chain agents are a flat `VecSet<address>`; real MCP pairing has the **agent generate its own key** and the user paste the **address**, with a 3-var env (incl. `ANIMA_OWNER_ADDRESS`). → **Decide:** redesign the dialog to an address-registration flow; decide where label/device-kind metadata lives (off-chain map vs cosmetic-only).

9. **Settings "Milestones"** — four hardcoded milestones; no telemetry source. → static decoration, or derive from on-chain events (needs an indexer).

10. **Agent timeline / scenario / MockedBadge / delay** — **demo scaffolding; delete, don't wire.** The `AgentEvent`/`Suggestion` *shapes* survive, fed by real MCP writes + `syncNewQuilts`, but the scripted `setTimeout` triggers go away.

---

## Decisions I need from you (the re-brainstorm)

1. **Canvas:** single shared board (ship) or multi-board library (build)?
2. **Folders:** reserved-note persistence, ephemeral, or tag-only?
3. **Covers:** preset-only or real uploads?
4. **Rename:** local label or new Move entry + redeploy?
5. **Share:** drop "edit link" + adopt `/read.html?b=` + rebuild reader — OK?
6. **Home calendar / GCal / suggestions:** build, static-for-video, or cut?
7. **Pairing flow:** app-generates-key (current UI, wrong) vs user-pastes-address (real)?
8. **Wallet stack:** confirm `@mysten/dapp-kit` for the Foundation build.

## Recommended cut (my opinion, deadline-aware)

Ship the **Tier-0 Foundation + all of Tier-1**, and take the *honest* path on Tier-2:
collapse to the **single shared canvas**, **preset-only covers**, **tag-derived folders**
(or a tiny reserved-note if time), **rename = local label**, **publish = read-only +
rebuilt reader** (drop edit-link), **Home calendar/GCal = static for the video**,
**fix the pairing dialog** to address-registration, **delete the mock scaffolding**.
That delivers every real demo beat (onboard → chat-remembers → recall → vault →
forget → live canvas with a real agent peer → publish → resurrection) on a fully
integrated stack, and scopes out only the invented surfaces that can't be made real
and honest before the deadline.

## Coordinate with `docs-site`

The Fumadocs site (`docs-site/content/docs/build/concepts/*`) documents two-key model,
custody, Seal, Walrus, resurrection. Run a docs-truth pass so the shipped product
matches the concept pages — and so the UI copy doesn't promise (semantic recall,
multiplayer "edit links", GCal sync) what the integrated system doesn't do.
