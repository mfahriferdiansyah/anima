# Anima — Walrus + Seal Honesty Audit

_2026-06-22. Multi-agent code audit + web research + adversarial refutation, reconciled against primary sources (the repo, the `@mysten/seal@1.1.3` SDK, and Seal's `errors.rs`)._

## 1. Verdict

| Layer | Verdict | Confidence |
|---|---|---|
| **Walrus** | **Real** — load-bearing, the only _durable_ store of note content | High |
| **Seal** | **Real** — threshold IBE + live key servers + on-chain `seal_approve` gate | High |
| **Backend** | **Stateless** — no database, stores no content | High |

Both primitives are genuinely used, not faked. One honest correction to any "ONLY store of content" phrasing: a **per-tab `sessionStorage` decrypted-index cache** holds plaintext while a tab is open. It is non-durable, disclosed, and cleared on disconnect — Walrus remains the **sole durable** store of record — but it is an off-Walrus copy of content the app reads cache-first on refresh.

## 2. Do we really use Walrus? — Yes

Full lifecycle through the real `@mysten/walrus` SDK; no off-Walrus _durable_ content store.

- **Encrypt → write.** `chain/core/src/quilts.ts:31` `writeTurn`: each note → `WalrusFile.from({ contents: await seal.encryptNote(...) })` → `walrus.writeFiles({ files, epochs:53, deletable:true, signer:agentSigner, attributes:{app:'anima',vault} })`. Unconditional — no plaintext branch on the note path.
- **Wallet-owned Blob.** `quilts.ts:52` transfers the Blob object to `walletAddress` (agent-signed, status-checked). Only the wallet can delete.
- **Resurrection read (Walrus + Seal alone).** `quilts.ts:73` `listVaultQuilts` pages `getOwnedObjects` by Walrus Blob `StructType`, keeps blobs whose on-chain attributes are `app:'anima' + vault:vaultId`. `quilts.ts:157` `readOneQuilt`: `getBlob({blobId}).files() → bytes() → seal.decryptNote → parseNote`, in a 5× retry for storage-node lag.
- **Browser byte transport.** `quilts.ts:122` `installAggregatorReads` routes reads through `{aggregator}/v1/blobs/{blobId}` (direct sliver endpoints aren't CORS-enabled). SDK still parses the quilt; caller still Seal-decrypts each patch.
- **Delete.** Wallet-signed `walrus.deleteBlobTransaction`; forget rewrites survivors first.
- **Live proof.** `chain/core/src/spike-core.ts`: onboard → write 3 → assert Blob `AddressOwner === walletAddr` → cold rebuild → edit-to-v2 → wallet-signed forget → rebuild shows the forgotten note gone. `spike.ts` proves byte-identical `writeFiles/getFiles` + deletable delete.
- **No durable off-Walrus store.** Backend `go.mod` has zero DB drivers; `main.go`: _"stateless LLM proxy. No database."_ `distill.go`: _"the backend returns it and forgets it."_ Presence relay persists nothing. Only `localStorage` write is a `'1'/'0'` resurrection flag (`milestones.ts:90`). Mock stores are imported **only** by the marketing landing preview.

## 3. Do we really use Seal? — Yes

- **Threshold IBE encrypt.** `seal.ts:104` `encryptNote` → `client.encrypt({ threshold:2, packageId, id:identityForOwner(owner), data, aad:aadFor(vaultId,noteId) })`; real `new SealClient({ serverConfigs:chainConfig.keyServers, verifyKeyServers:false })`.
- **3 key servers, threshold 2.** `chain.json`: `0x73d0…` Mysten testnet-1, `0xf5d1…` Mysten testnet-2, `0x6068…` Ruby Nodes. (Ruby's open-vs-permissioned mode is reported inconsistently across sources; it does not change the mechanism below.)
- **Decrypt needs live shares.** SDK `decrypt` throws "Not enough shares" below threshold; shares are populated only by `fetchKeys`, and only **after** `verifyUserSecretKey` checks each share against the server's **on-chain** public key. No local-only decrypt path.
- **On-chain `seal_approve` gate.** `contract/sources/vault.move:66`: asserts `id == bcs(owner)` **and** `sender == owner || vault.agents.contains(sender)`; register/revoke owner-gated. The client's approval PTB (`seal.ts:60`) calls exactly this. `contract/tests/vault_tests.move` has `expected_failure(ENoAccess)` negatives. Live `spike-seal.ts` proves an allowlisted non-owner agent decrypts, an outsider (fresh keypair, no cache) is **denied**, and a freshly-revoked agent on a **fresh** client is denied.

**`verifyKeyServers:false` — honest hardening gap (not a bypass).** Skips only the init-time `/v1/service` proof-of-possession check of each server URL. The threshold fetch, per-share on-chain pubkey verification, and `seal_approve` policy all still run. Risk: a swapped/malicious server config isn't detected at init. Acceptable for fixed testnet servers; flip to `true` / pin for production.

## 4. The 403 explained (corrected)

**Cause:** one of the three key servers returns **403** to `POST {url}/v1/fetch_key` during `prewarmKeys → client.fetchKeys` (`seal.ts:88`); the **2-of-3 threshold still completes**, so decrypt succeeds.

**Why decrypt still succeeds:** the SDK fan-out (`client.mjs:197-235`) runs all three in `Promise.allSettled`, pushes each server error into `errors[]` **without** rethrowing, and resolves the moment `completedWeight ≥ threshold` (2). It only throws `toMajorityError` when **fewer than threshold** succeed. One 403 of three (threshold 2) leaves two successes = met. The app's terminal `if (e instanceof NoAccessError) throw e` (`seal.ts:97,130`) fires only when `fetchKeys` _itself_ throws — i.e. 2+ servers fail — so a lone-server 403 is invisible to the app.

**What a 403 actually is** (Seal `errors.rs`, authoritative): **403** = `NoAccess`, `InvalidPackage`, `InvalidSessionSignature`, `InvalidCertificate`, `InvalidPTB`, `InvalidParameter`. **400** = `UnsupportedPackageId` (a server that doesn't serve your package), SDK-version/header errors. **There is no 429** — rate-limiting is infra/proxy-layer.

So the most likely lone-server 403 is **`NoAccess`**: that server's `seal_approve` dry-run denied because its fullnode hasn't yet indexed the freshly-paired agent into `vault.agents` (allowlist-indexing lag — the exact scenario `seal.ts:78-80` documents), or a transient session/cert mismatch (`InvalidSessionSignature`/`InvalidCertificate`). A _genuine_ deny (agent truly not allowlisted) returns `NoAccess` **from all three** servers at once (same on-chain check) → `fetchKeys` throws → loud "Could not unlock the vault keys." So **one 403 + visible notes ≠ a real deny.**

**How to confirm benign vs broken:**
1. Network tab: the 403 is on `…/v1/fetch_key` to **one** host, the other **two** return **200** → threshold met → benign. Read the JSON body for the variant (`NoAccess` vs `InvalidPackage`).
2. Confirm the app did **not** enter the "Could not unlock the vault keys" rebuild error (`session.ts:196`).
3. If the 403 is on `…/v1/blobs/…` (aggregator), confirm a later retry returns 200 (transient). Walrus aggregators return **451** for a blocked blob and **404** for not-yet-propagated — a 403 there is the CDN/WAF edge or a CORS-blocked direct sliver read, both retry-masked by `readOneQuilt`'s 5× loop.

**Fix (the 403 is cosmetic noise, not a failure):** if it's consistently the same (third) server, drop or replace its objectId in `chain/core/src/generated/chain.json` `keyServers[]` — e.g. swap `0x6068…` for another verified **open** server — mirroring the earlier NodeInfra removal. Threshold 2 only needs two healthy servers. Trade-off: dropping to the two Mysten servers alone removes redundancy (both must be up; Mysten testnet has no SLA), so prefer a 3-open-server config.

## 5. Honest caveats / real findings (from the adversarial pass)

1. **"Only store of content" is literally false → say "only _durable_ store."** `indexCache.ts` writes the **decrypted** vault index to `sessionStorage` (`saveIndexCache`, debounced on every `vaultData` change), and `session.ts:159-166` serves it **cache-first** on same-tab refresh with **zero** Walrus/Seal access. Per-tab, never on disk, cleared on disconnect — but it is plaintext content outside Walrus, read in place of Walrus on refresh.
2. **Cache _can_ mask a real failure — FIXED 2026-06-22.** On a same-tab refresh **with a cache present AND new quilts to read**, a revoked/unpropagated agent gets a terminal `NoAccess` from `syncNewQuilts → readOneQuilt → decryptNote`, and `backgroundSync`'s blanket `catch {}` used to **swallow it and keep stale notes on screen**. Fix (`session.ts` `backgroundSync`): the catch now distinguishes a terminal `NoAccessError` — it drops the cache (`clearIndexCache`, which also stops the auto-cache subscription) and transitions the session to `needs-pairing` with honest copy ("This device's access to the vault was revoked. Pair again to restore it."); `pair()` re-runs `seal_approve`, so re-authorization is the recovery. **Every other error** (offline / one flaky key server / transient indexing lag, which is tolerated below the SDK throw and short-circuits when nothing is new) still keeps the cached view and retries next load. Guarded by `gen !== generation` so an account switch mid-sync can't clobber the new account.
3. **AAD on decrypt is dead code.** `decryptNote` passes `aad` via an `as any` cast, but the SDK `decrypt` reads AAD from the ciphertext and ignores the arg. GCM still authenticates the embedded AAD against tampering, but the app never re-checks that the embedded AAD matches the requested `noteId`; since all of a user's notes share one identity (owner address), per-note binding isn't verified on read. Low severity — add a post-decrypt assert or a comment.
4. **Operator concentration.** 2 of 3 servers are Mysten; threshold 2 means a Mysten outage degrades to one healthy server and decrypts stall. Diversify operators across the three slots for liveness.
5. **Stateless ≠ zero-knowledge.** The backend persists nothing, but `/chat`, `/distill`, `/suggest` send **decrypted** note bodies to OpenRouter for inference, and the presence relay fans out plaintext content-ops during an active share. Disclosed in code; stores nothing; but they are real plaintext transit paths.
6. **Test-surface.** The full browser `useVault`/`useCanvas` round-trip is unit/jsdom-tested + boot-clean; the live on-chain proof is the node scripts (`spike-core.ts`, `spike-seal.ts`, `e2e-chat.ts`) + a browser `writeTurn` smoke. Shared `chain/core` code, so a test-surface gap, not a content bypass.

## 6. For the submission

The **load-bearing Walrus + Seal** claim is defensible. Content is Seal-threshold-encrypted before every Walrus write, stored only as wallet-owned Walrus Blobs, and resurrected from Walrus + Seal alone — with a backend that provably has no database. Kill the server and the vault survives; that is the real differentiator versus a Postgres app. State it precisely: **Walrus is the only durable store of content**, with a disclosed per-tab speed cache, and `verifyKeyServers:false` as a known production toggle.

**Sharpest demo beat — Seal _enforcement_ contrast, not authorship display.** On a fresh (cacheless) device: (1) the **owner** resurrects the full vault from Walrus + Seal with the **backend offline** — content lives on Walrus, not a server. (2) An **un-paired device** visibly fetches the encrypted bytes from Walrus but is **denied** by the live key servers (`seal_approve` → terminal `NoAccess`) and **cannot decrypt**. (3) The owner **revokes** an agent on-chain; that agent on a **fresh** client is then denied (`spike-seal.ts revokedFreshDenied`). The three-step — resurrect / deny outsider / revoke-then-deny — is the one beat a centralized DB cannot replicate, and it is already proven live by the spike scripts.
