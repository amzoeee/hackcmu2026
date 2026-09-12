#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export RUSTUP_HOME="$PROJECT_ROOT/.tools/rustup"
export CARGO_HOME="$PROJECT_ROOT/.tools/cargo"
export PATH="$PROJECT_ROOT/.tools/bin:$CARGO_HOME/bin:$PROJECT_ROOT/.tools/solana-release/bin:$PATH"
cd "$PROJECT_ROOT"
exec "$@"
