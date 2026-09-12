#!/usr/bin/env bash
set -euo pipefail
# Build and verify the binary, program key, configuration, and generated client together.
bash scripts/build-program.sh
anchor deploy --provider.cluster devnet -- "$@"
