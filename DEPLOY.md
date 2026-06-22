# Deploying Anima on Coolify

Three apps, **no database**. The backend is stateless by design (no DB, no
session store, no volumes); the vault lives on Walrus under the user's wallet.
The Move contract is already published on testnet, and the `anima-mcp` connector
runs user-side next to the agent — neither is something you host.

| App           | What it is                       | Build pack | Base dir       | Serves on |
| ------------- | -------------------------------- | ---------- | -------------- | --------- |
| **backend**   | Stateless Go LLM proxy (chi)     | Dockerfile | `/backend`     | `:8080`   |
| **frontend**  | Vite + React SPA (static)        | Dockerfile | `/` (repo root)| `:80`     |
| **docs-site** | Fumadocs / Next static export    | Nixpacks   | `/docs-site`   | static    |

Each is a separate Coolify "Application" pointed at the same `anima` repo,
branch `main`.

---

## 0. Decide the three domains first

The apps reference each other's URLs, so pick all three before deploying:

| App       | Suggested domain         |
| --------- | ------------------------ |
| frontend  | `anima.kadzu.dev`        |
| backend   | `api-anima.kadzu.dev`    |
| docs-site | `docs-anima.kadzu.dev`   |

Coolify (Traefik) terminates TLS / Let's Encrypt for all three.

---

## 1. Backend (deploy this first)

The backend already ships a `Dockerfile` — nothing to add.

**Coolify → Create Application → from the `anima` repo:**

| Field             | Value           |
| ----------------- | --------------- |
| Branch            | `main`          |
| Build Pack        | **Dockerfile**  |
| Base Directory    | `/backend`      |
| Port              | `8080`          |
| Is it a static site? | No           |
| Domain            | `api-anima.kadzu.dev` |

**Environment variables** (Settings → Environment Variables):

| Variable             | Value                                   | Mark secret? |
| -------------------- | --------------------------------------- | ------------ |
| `OPENROUTER_API_KEY` | your OpenRouter key                     | **Yes**      |
| `JWT_SECRET`         | a long random string (`openssl rand -hex 32`) | **Yes** |
| `ALLOWED_ORIGINS`    | `https://anima.kadzu.dev`               | no           |
| `DEFAULT_MODEL`      | `anthropic/claude-sonnet-4.5` (optional)| no           |
| `RATE_LIMIT_PER_MIN` | `30` (optional)                         | no           |

- `ALLOWED_ORIGINS` is the #1 thing to get right: it's an **exact-match**,
  comma-separated list. It must be the frontend's real origin, `https`, **no
  trailing slash**. If it's wrong, the app loads but every backend call fails on
  CORS.
- The repo's `backend/.env` holds a real OpenRouter key and a placeholder
  `JWT_SECRET=any-random-string`. That file is git-ignored (not in the repo),
  but **set both via Coolify's secret store, not a committed file**, and
  generate a real `JWT_SECRET`. If that OpenRouter key has been pasted around,
  rotate it.

**Verify:** `curl https://api-anima.kadzu.dev/auth/nonce` → `{"nonce":"anima:..."}`

---

## 2. Frontend

Newly added in this repo: `frontend/Dockerfile` + `frontend/nginx.conf` +
root `.dockerignore`. The Dockerfile builds the SPA and serves it via nginx with
SPA history fallback (so `/app/notes/:id` survives a refresh) while still serving
the standalone `read.html` share page as a real file (share links resolve to
`/read.html?b=...`).

> Why a Dockerfile and not the plain Static build pack: the SPA imports shared
> code from `chain/` and there's no `frontend/package.json`, so the build must
> run from the repo root. The nginx config also guarantees the SPA fallback +
> dual entry, which the built-in static server doesn't handle reliably.

**Coolify → Create Application → from the `anima` repo:**

| Field                | Value                  |
| -------------------- | ---------------------- |
| Branch               | `main`                 |
| Build Pack           | **Dockerfile**         |
| Base Directory       | `/` (repo root)        |
| Dockerfile Location  | `/frontend/Dockerfile` |
| Port                 | `80`                   |
| Is it a static site? | No (nginx serves it)   |
| Domain               | `anima.kadzu.dev`      |

**Build-time variables** — `VITE_*` are inlined at **build** time, so set these
as build variables (Coolify env vars with "Build Variable / available at
buildtime" enabled), not runtime env:

| Variable              | Value                                            |
| --------------------- | ------------------------------------------------ |
| `VITE_BACKEND_URL`    | `https://api-anima.kadzu.dev`                    |
| `VITE_AGGREGATOR_URL` | `https://aggregator.walrus-testnet.walrus.space` (default, optional) |
| `VITE_GOOGLE_CLIENT_ID` | your OAuth web client id (optional — Calendar shows "not configured" if unset) |

- If you use `VITE_GOOGLE_CLIENT_ID`, add `https://anima.kadzu.dev` to the OAuth
  client's **Authorized JavaScript origins** in Google Cloud Console, or the
  Calendar integration fails on that origin.
- Changing any `VITE_*` requires a **rebuild** (not just a restart).

---

## 3. Docs-site

Already configured — `docs-site/nixpacks.toml` pins Node 22 and the static
export. Nothing to add.

**Coolify → Create Application → from the `anima` repo:**

| Field                | Value                          |
| -------------------- | ------------------------------ |
| Branch               | `main`                         |
| Build Pack           | **Nixpacks**                   |
| Base Directory       | `/docs-site`                   |
| Is it a static site? | **Yes**                        |
| Publish Directory    | `out`                          |
| Install command      | `pnpm install --frozen-lockfile` |
| Build command        | `pnpm build`                   |
| Domain               | `docs-anima.kadzu.dev`         |

**Serving contract** (so the agent-readable layer works): serve `/llms.txt` and
`/llms-full.txt` as `text/plain` inline, `/md/<path>.md` as `text/markdown`, and
keep everything public (no auth wall). See `docs-site/README.md` for detail.

---

## Order & gotchas

1. Deploy **backend** first → confirm `/auth/nonce`.
2. Deploy **frontend** with `VITE_BACKEND_URL` = the backend domain → confirm it
   loads and login works (login signs from the wallet in the browser).
3. Deploy **docs-site**.
4. Double-check `ALLOWED_ORIGINS` on the backend exactly equals the frontend
   origin — this is the most common failure.
5. `/chat` is **SSE (streaming)**. Traefik handles this fine by default; if you
   put any extra proxy in front, make sure it doesn't buffer responses.
6. This is a **testnet** deploy. Mainnet self-hosting is gated on Seal mainnet
   access and is not turnkey yet (see `docs-site/content/docs/build/self-hosting.mdx`).
