# ANIMA backend — stateless LLM proxy

A Go chi server that proxies chat to OpenRouter. **Stateless by design**: no
database, no session store, no logged content. Statelessness is the product's
custody claim — kill this server and the vault survives.

> Build facts only.

## Endpoints

| Method | Path           | Auth   | Purpose                                        |
|--------|----------------|--------|------------------------------------------------|
| GET    | `/auth/nonce`  | —      | Timestamped nonce (`anima:<unix-ms>:<hex>`)    |
| POST   | `/auth/verify` | —      | Wallet personal-message sig → 24h JWT          |
| POST   | `/chat`        | Bearer | Persona chat, SSE stream                       |
| POST   | `/distill`     | Bearer | Transcript → durable note candidates (JSON)    |

`/chat` and `/distill` are rate-limited per JWT subject (429 + `Retry-After`).
Auth supports **ed25519-flag wallets only** in v1 (zkLogin/multisig/secpk
wallets get a clear error).

## Configuration

| Env                  | Default                          | Notes                       |
|----------------------|----------------------------------|-----------------------------|
| `PORT`               | `8080`                           |                             |
| `OPENROUTER_API_KEY` | — (required)                     |                             |
| `OPENROUTER_BASE_URL`| `https://openrouter.ai/api/v1`   | Any OpenAI-compatible API   |
| `JWT_SECRET`         | — (required)                     |                             |
| `ALLOWED_ORIGINS`    | — (empty = no browser origins)   | Comma-separated, exact match|
| `RATE_LIMIT_PER_MIN` | `30`                             | Per JWT subject             |
| `DEFAULT_MODEL`      | `anthropic/claude-sonnet-4.5`    | Request `model` overrides   |

## Run

```sh
OPENROUTER_API_KEY=sk-or-... JWT_SECRET=dev-secret \
ALLOWED_ORIGINS=http://localhost:5173 go run ./cmd/api
```

Or via Docker: `docker build -t anima-backend . && docker run -p 8080:8080 -e OPENROUTER_API_KEY=... -e JWT_SECRET=... anima-backend`

## curl examples

Auth (the signature is produced by the wallet's `signPersonalMessage` over the
nonce bytes — base64 of `flag(1) || sig(64) || pubkey(32)`):

```sh
curl http://localhost:8080/auth/nonce
# {"nonce":"anima:1749600000000:9f2c..."}

curl -X POST http://localhost:8080/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"address":"0x<sui-address>","nonce":"anima:1749600000000:9f2c...","signature":"<base64-wallet-sig>"}'
# {"token":"eyJhbGciOiJIUzI1NiIs..."}
```

Chat (SSE — `data: {"delta":...}` per token, then `event: done`; failures emit
`event: error`):

```sh
curl -N -X POST http://localhost:8080/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "persona": "You are Anima, a warm companion.",
    "transcript": [{"role": "user", "content": "How did my sister'\''s wedding go?"}],
    "context": [{"noteId": "01J...", "title": "Sister'\''s wedding", "body": "Her sister married in May 2026 in Lisbon."}]
  }'
# data: {"delta":"It"}
# data: {"delta":" was"}
# ...
# event: done
# data: {}
```

Distill:

```sh
curl -X POST http://localhost:8080/distill \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":[{"role":"user","content":"I switched to oat-milk flat whites"}]}'
# {"notes":[{"title":"Coffee preference","body":"Drinks oat-milk flat whites.","tags":["coffee","preference"],"links":[]}]}
```

## Log discipline (custody invariant)

The request logger emits method/path/status/latency — nothing else. Request
bodies, query strings, `Authorization` headers, and message content are never
logged, on any path including errors. See `internal/middleware/logger.go`.

<!-- deploy: backend watch-path redeploy check (2026-06-26) -->
