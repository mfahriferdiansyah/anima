#!/usr/bin/env bash
# Publishes the ANIMA vault contract to Sui testnet and writes the generated
# chain config consumed by frontend, chain/core, and anima-mcp.
# NOTE: Seal pins the FIRST package version — never `sui client upgrade`;
# a policy change means republish + re-encrypt (seed script handles re-encrypt).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

cd "$REPO_ROOT/contract"
echo "→ publishing anima vault contract to testnet…"
rm -f Published.toml
OUT=$(sui client publish --gas-budget 200000000 --json)

PACKAGE_ID=$(node -e "
const raw = process.argv[1];
const j = JSON.parse(raw.slice(raw.indexOf('{')));
const pkg = (j.objectChanges ?? []).find(c => c.type === 'published');
if (j.effects?.status?.status !== 'success' || !pkg) { console.error('publish failed:', JSON.stringify(j.effects?.status)); process.exit(1); }
console.log(pkg.packageId);
" "$OUT")

echo "→ packageId: $PACKAGE_ID"

CONFIG=$(cat <<EOF
{
  "network": "testnet",
  "packageId": "$PACKAGE_ID",
  "vaultModule": "vault",
  "keyServers": [
    { "objectId": "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", "weight": 1 },
    { "objectId": "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", "weight": 1 },
    { "objectId": "0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2", "weight": 1 },
    { "objectId": "0x5466b7df5c15b508678d51496ada8afab0d6f70a01c10613123382b1b8131007", "weight": 1 }
  ],
  "sealThreshold": 2,
  "uploadRelay": "https://upload-relay.testnet.walrus.space",
  "aggregator": "https://aggregator.walrus-testnet.walrus.space"
}
EOF
)

mkdir -p "$REPO_ROOT/frontend/src/generated" "$REPO_ROOT/chain/core/src/generated"
echo "$CONFIG" > "$REPO_ROOT/frontend/src/generated/chain.json"
echo "$CONFIG" > "$REPO_ROOT/chain/core/src/generated/chain.json"
echo "→ wrote frontend/src/generated/chain.json + chain/core/src/generated/chain.json"
