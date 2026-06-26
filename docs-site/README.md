# Anima docs (Fumadocs)

The Anima documentation site, built with [Fumadocs](https://fumadocs.dev) 16 on
Next.js 16 (App Router). It ships as a **fully static site**: `pnpm build`
emits an `out/` directory of HTML plus the agent-readable layer
(`llms.txt`, `llms-full.txt`, and per-page markdown), with no Node server to
run. Static output is what lets the docs ship to a Walrus Site or any static
host.

## Local development

```bash
pnpm install
pnpm dev        # http://localhost:3000 (this repo runs it on 3001)
pnpm build      # produces ./out (static export)
```

Node 22 and pnpm. Content lives in `content/docs/` as MDX; the nav order is set
by the `meta.json` files alongside it.

## What gets built

`pnpm build` (with `output: 'export'` in `next.config.mjs`) produces `out/`:

- **Page HTML** for every docs page, plus the home page (`out/index.html`).
- **`out/llms.txt`** — the index: a titled, linked map of every page, with the
  developer-track scope stated at the top.
- **`out/llms-full.txt`** — every page concatenated as clean markdown.
- **`out/md/<path>.md`** — one clean-markdown file per docs page (for example
  `out/md/use/notes.md`), the same source the in-page "copy markdown" button
  fetches.
- **`out/api/search`** — the prebuilt static search index. Search runs in the
  browser against this index (Orama static client), so there is no live search
  API route. This is required under static export.

## Coolify deploy (static site)

Deploy this directory as a **static site** behind Coolify.

| Setting | Value |
| --- | --- |
| Build pack | **Nixpacks** (uses `nixpacks.toml`, which pins Node 22) |
| Base Directory | `docs-site` |
| Is it a static site? | **Yes** |
| Publish Directory | `out` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Watch Paths | `docs-site/**` |
| Domain | `docs-anima.kadzu.dev` (Traefik terminates SSL / Let's Encrypt) |

Because the build is static, there is no port to expose and no server process to
keep alive. Coolify serves `out/` directly through its static (Traefik) path.

### Serving contract

The agent-readable layer only works if the static host serves the right content
types and does not gate anything behind auth. Configure the proxy (Traefik /
Coolify static serving) so that:

- **`llms.txt` and `llms-full.txt`** are served as `text/plain` (UTF-8), inline
  (not as a download), at `/llms.txt` and `/llms-full.txt`.
- **Per-page markdown** (`/md/<path>.md`) is served as `text/markdown`. The
  route handler sets `Content-Type: text/markdown; charset=utf-8`, but under
  static export that header is not embedded in the emitted file. Serving the
  correct content type for `.md` is therefore the static host's job. Most
  servers map `.md` to `text/markdown` by default; if yours does not, add the
  mapping.
- **No auth wall.** These files and pages must be publicly reachable without a
  login, cookie, or token, so an external agent (and the in-page copy button)
  can fetch them directly.

### Why static (the Walrus dogfood)

A pure-static `out/` is portable to a Walrus Site, which is the point: the docs
for a "your data survives the app" product are themselves served from
user-owned, decentralized storage. Keeping the build static (no server-only
features) preserves that path.

## Notes on the build

- **Search is static.** `app/api/search/route.ts` exports
  `{ staticGET: GET }` from `createFromSource(source)` with
  `revalidate = false`, and `RootProvider` in `app/layout.tsx` is configured
  with `search={{ options: { type: 'static' } }}`. The dynamic `/api/search`
  route would be incompatible with static export.
- **Per-page markdown** is served from `app/md/[...slug]/route.ts`. It uses a
  clean catch-all segment (the `.md` is baked into the slug value via
  `generateStaticParams`), because a literal `.md` suffix on a route folder is
  not treated as a dynamic segment, and static export does not support the
  rewrite-based approach from the Fumadocs default recipe.
- **`images.unoptimized: true`** is set because the Next image optimizer cannot
  run at request time in a static export.

<!-- deploy: docs-site watch-path redeploy check (2026-06-26) -->
