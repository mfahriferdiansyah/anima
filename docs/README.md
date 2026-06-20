# Anima docs (docs.anima.app)

A self-contained Starlight (Astro) documentation site. It has its own
`package.json` and `pnpm-lock.yaml` and builds to a static `dist/`, fully
isolated from the app frontend and the Go backend.

## Local

```bash
pnpm install
pnpm dev      # local preview at http://localhost:4321
pnpm build    # static build into dist/
```

## Deploy (Coolify, self-hosted)

Deployed as its own Coolify application, separate from the app and the backend.
Dashboard settings:

- **Buildpack:** Nixpacks. Do not use the "Static" buildpack: it has no build
  step and cannot run `astro build`.
- **Is it a static site?** On. **Publish directory:** `dist`.
- **Base Directory:** `docs`. This package is self-contained, so the build runs
  cleanly from here.
- **Watch Paths:** `docs/**`. Without this, every commit on the shared branch
  would redeploy the docs app; scoping it means only changes under `docs/`
  trigger a rebuild.
- **Domain:** `https://docs.anima.app`. Coolify's Traefik provisions a Let's
  Encrypt certificate automatically once DNS points at the server.
- **Node** is pinned in `nixpacks.toml`. If the build picks the wrong Node or
  pnpm, set `NIXPACKS_NODE_VERSION` or adjust `nixpacks.toml`, and verify on the
  first deploy.

## Serving contract (agent-readable layer)

The agent layer (the `mcpdoc` pointer and the per-page "view as markdown" URLs)
depends on how these files are served. After the first deploy, confirm with
`pnpm --dir docs check:serving` (the post-deploy smoke) against the live URL:

- `/llms.txt`, `/llms-full.txt`, `/llms-small.txt` are served as `text/plain`.
- Per-page `/<slug>.md` is served as `text/markdown` or `text/plain`, not
  `application/octet-stream` and not as a forced download.
- None of these sit behind an auth wall or a challenge page.

Browser CORS is a verify-on-first-deploy item: `mcpdoc` fetches server-side via
`uvx`, so it likely does not need permissive CORS, but the serving smoke checks
fetchability either way.
