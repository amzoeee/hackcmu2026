#!/usr/bin/env bash
set -euo pipefail
# Build and verify the binary, program key, configuration, and generated client together.
bash scripts/build-program.sh
# Allocate enough space using the cluster's minimum extension before the older CLI uploads.
node scripts/ensure-program-capacity.mjs
anchor deploy --provider.cluster devnet -- "$@"
