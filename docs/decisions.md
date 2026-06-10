# Build Decisions (living log)

## U1 commit gate — 2026-06-10 — **GO** ✅

All checks passed on Sui testnet (epoch ~424). Evidence: `chain/core/spike-results.json`, `chain/core/spike-seal-results.json`, spike sources `chain/core/src/spike{,-seal}.ts`.

### Verified facts & benchmarks
- **Quilt round-trip (relayer-free path through upload relay):** write ~10s, read ~1.2s, byte-identical. Quilt of 2 markdown notes ≈ 0.0006 WAL (1 epoch ballpark; live unit prices: storage 3076 / write 6152 FROST per MiB-unit).
- **Keystone (THE architecture bet):** Seal key servers honor our `seal_approve` allowlist — a NON-owner registered agent with a **self-signed** SessionKey decrypted in **712ms** (2-of-4: mysten×2, Ruby, NodeInfra). Encrypt 507ms. Zero `InvalidParameter` retries even seconds after vault creation.
- **Ownership decision → OPTION (B):** `owner:` param with agent signer is **dead** (tx demands the owner's signature — and WAL is sourced from the owner). Path: agent writes (owner = agent) → `transferObjects(blob → wallet)` post-certify → **wallet owns the blob on-chain and successfully deleted it** (acceptance i ✓). R12's explorer beat works as designed.
- **Deletable blobs:** wallet-signed delete in 1.7s; reads may serve briefly from cache post-delete (on-chain state is authoritative — narrate if asked).
- **Revocation semantics (better than planned):** post-revoke, even the previously-used SealClient was denied on next decrypt (each decrypt with a fresh SessionKey re-consults key servers). Residual caveat narrows to: an agent holding BOTH a still-live SessionKey AND already-fetched cached keys within TTL. README caveat stays, softened.
- **Funding flow:** faucet → wallet → agent transfer (0.6 SUI) → `wal_exchange::exchange_all_for_wal` (function list confirmed on-chain). Faucet is per-IP rate-limited — pre-fund and never demo-day faucet (as planned).
- **Tx hygiene:** always `waitForTransaction` after execute before dependent txs (stale-version errors otherwise — bit us twice).

### Design corrections discovered
1. **`create_vault` must take the first agent as a parameter.** A shared object cannot be created and mutated in the same PTB — without this, F0 needs two wallet popups. Final contract: `create_vault(name, first_agent)`. (Spike contract used two txs.)
2. `blobObject.id` is a plain string in walrus 1.1.7 (not `{id: {id}}`).
3. With `owner:` set, the SDK sources WAL from the OWNER's balance — another reason option (a) was never viable for silent writes.

### Spike infrastructure (reused going forward)
- Throwaway publish: package `0xdd5609e700b89eae1c11948e89bc45c506ee3a3a1a025d4eaad964c7203108d4`, spike vault `0x9819ad4c…0a52`. The REAL publish happens after U2 tests (Seal pins the first package version — never upgrade; republish + re-encrypt instead).
- Funded testnet keys in `chain/core/.spike-keys.json` (gitignored).
- sui CLI 1.73.1 at `~/.local/bin/sui`; keystore alias `spike-wallet`.
