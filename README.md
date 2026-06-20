# anima

**Anima is an agentic workspace where your own AI agents and your team read and write the same notes and canvas, sealed to storage you own, so it survives any app.**

Your notes and canvas live on one shared board where you, your team, and your own AI tools all work. Claude Code, Codex, or any agent you already use can connect and read and write the same notes, each edit signed (name + rev). Every note is human-readable markdown stored on [Walrus](https://walrus.xyz), sealed with [Seal](https://seal-docs.wal.app) under your [Sui](https://sui.io) wallet, so it outlives any app, including ours.

Built for [Sui Overflow 2026](https://overflow.sui.io), Walrus track. Brand and narrative are canonical in [`docs/positioning.md`](docs/positioning.md).

## Why

The notes and work your AI agents accumulate are valuable, and on a normal SaaS you don't own them, can't read them, and lose them at the vendor's whim. Replika's "lobotomy" turned years-old companions into strangers overnight. Dot shut down with 30 days to export. Meta bought Limitless and gave users 14 days before deletion. Anima makes that structurally impossible: your notes live on neutral ground, readable and editable by you, sealed to your wallet, not to any company, including us. That custody and survival is what a Postgres + S3 SaaS cannot structurally promise.

## What it does

- **Your own agents read and write.** `anima-mcp` lets Claude Code, Cursor, or any agent you use read and write the same notes, each edit signed (name + rev).
- **Notes and canvas.** Browse, search, edit, and delete your notes; edits change agent behavior live.
- **Cited answers.** "What do you know about my sister?" gets an answer that navigates to and cites the notes.
- **Forget, for real.** Deletion is wallet-gated and verifiable.
- **Built-in companion.** A default agent that remembers across sessions and writes durable facts back as notes you can read (a resident, not the product).
- **Resurrection.** Kill the app, open another client with a different model, connect your wallet: full notes intact.
- **Export.** Your whole workspace as a markdown zip; file over app.

## Structure

```
frontend/   React + Vite + TS: wallet, chat, notes, canvas
backend/    Go: chat API, LLM orchestration (OpenRouter default, modular providers)
chain/      TS workspace
  core/       shared Walrus (quilts) + Seal + vault logic
  service/    HTTP chain-service
  mcp/        anima-mcp, stdio MCP server, runs user-side (npx)
contract/   Move: Seal access policy (the only on-chain code)
docs/       requirements, plans, demo script, positioning
```

## Status

Building period: May 7 to June 21, 2026. Testnet first, mainnet-ready architecture.
