# Anima SPA image.
#
# IMPORTANT: build context is the REPO ROOT, not frontend/. The SPA imports
# shared code from chain/ and there is no frontend/package.json — the build is
# driven by the root package.json's `build` script. In Coolify set:
#   Build Pack         = Dockerfile
#   Base Directory     = /            (build context = repo root)
#   Dockerfile Location = /frontend/Dockerfile
#
# VITE_* values are inlined at build time, so they must be passed as build args
# (Coolify "Build Variable" env vars), not runtime env.

FROM node:22-alpine AS build
WORKDIR /app
# Pin pnpm to the version that produced pnpm-lock.yaml (lockfileVersion 9.0) so
# --frozen-lockfile is deterministic. Installed via npm rather than corepack to
# avoid corepack's signature-key check failing on some node:22-alpine builds.
RUN npm install -g pnpm@10.11.1

ARG VITE_BACKEND_URL
ARG VITE_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_AGGREGATOR_URL=$VITE_AGGREGATOR_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Install deps first (cached unless the manifest or lockfile changes).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Then the source (chain/ is required by the frontend's reader/web3 modules).
COPY . .
RUN pnpm build

# Serve the static bundle with SPA fallback (see nginx.conf).
FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
