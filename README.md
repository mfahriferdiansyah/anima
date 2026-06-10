# anima

**Apps are bodies. Memory is the soul. Anima keeps the soul.**

An Obsidian-style memory vault for AI agents — every memory is a human-readable markdown note stored on [Walrus](https://walrus.xyz), encrypted with [Seal](https://seal-docs.wal.app), owned by your Sui wallet — with a companion that lives in the vault: it consults your memories on every turn, writes new ones as notes you can read, and browses the vault *for* you. The app can die. Your friend doesn't.

Built for [Sui Overflow 2026](https://overflow.sui.io), Walrus track.

## Why

AI products' accumulated memory of you is their most valuable asset — and you don't own it, can't read it, and lose it at the vendor's whim. Replika's "lobotomy" turned years-old companions into strangers overnight. Dot shut down with 30 days to export. Meta bought Limitless and gave users 14 days before deletion. Anima makes that structurally impossible: memory lives on neutral ground, readable and editable by you, attached to your wallet — not to any company, including us.

## What it does

- **Companion chat** — remembers across sessions; every durable fact becomes a markdown note
- **Vault view** — browse, search, edit, and delete your agent's memories like Obsidian notes; edits change behavior live
- **Companion-driven browsing** — "what do you know about my sister?" → it navigates and cites the notes
- **Forget, for real** — deletion is wallet-gated and verifiable
- **One brain, many agents** — `anima-mcp` lets Claude Code / Cursor share the same vault
- **Resurrection** — kill the app, open another client with a different model, connect your wallet: full memory intact
- **Export** — your whole vault as a markdown zip; file over app

## Structure

```
frontend/   React + Vite + TS — wallet, chat, vault UI
backend/    Go — chat API, LLM orchestration (OpenRouter default, modular providers)
chain/      TS workspace
  core/       shared Walrus (quilts) + Seal + vault logic
  service/    HTTP chain-service
  mcp/        anima-mcp — stdio MCP server, runs user-side (npx)
contract/   Move — Seal access policy (the only on-chain code)
docs/       requirements, plans, demo script
```

## Status

Building period: May 7 – June 21, 2026. Testnet first, mainnet-ready architecture.
