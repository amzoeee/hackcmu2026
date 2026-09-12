#!/usr/bin/env bash
set -euo pipefail
node scripts/ensure-program-key.mjs
mkdir -p target/idl target/types
# Anchor 0.32 forwards build flags to IDL's cargo test too, so build separately.
anchor build --no-idl -- --tools-version v1.56
anchor idl build --out target/idl/accountability.json --out-ts target/types/accountability.ts
node scripts/sync-idl.mjs
node scripts/ensure-program-key.mjs --check-idl
