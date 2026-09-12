#!/usr/bin/env bash
# Install project-local tools without changing shell profiles or global Solana config.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
PROGRAM_KEY_MODE=--setup
if [[ "${1:-}" == "--new-program" && $# -eq 1 ]]; then
  PROGRAM_KEY_MODE=--new-program
elif [[ $# -ne 0 ]]; then
  echo 'Usage: npm run tools:setup [-- --new-program]' >&2
  exit 1
fi
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TOOL_TARGET=aarch64-apple-darwin ;;
  Darwin-x86_64) TOOL_TARGET=x86_64-apple-darwin ;;
  Linux-x86_64) TOOL_TARGET=x86_64-unknown-linux-gnu ;;
  *) echo "Install Rust, Anchor 0.32.1 and Solana 2.3.0 manually for this platform." >&2; exit 1 ;;
esac
mkdir -p .tools/bin .tools/downloads .wallets target/deploy
export RUSTUP_HOME="$PROJECT_ROOT/.tools/rustup"
export CARGO_HOME="$PROJECT_ROOT/.tools/cargo"
export PATH="$PROJECT_ROOT/.tools/bin:$CARGO_HOME/bin:$PROJECT_ROOT/.tools/solana-release/bin:$PATH"
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  curl -fsSL --retry 3 https://sh.rustup.rs -o .tools/downloads/rustup-init.sh
  sh .tools/downloads/rustup-init.sh -y --profile minimal --default-toolchain stable --no-modify-path
fi
rustup component add rustfmt clippy
if [[ ! -x .tools/bin/anchor ]]; then
  curl -fL --retry 3 "https://github.com/otter-sec/anchor/releases/download/v0.32.1/anchor-0.32.1-$TOOL_TARGET" -o .tools/bin/anchor
  chmod +x .tools/bin/anchor
fi
if [[ ! -x .tools/solana-release/bin/solana ]]; then
  curl -fL --retry 3 "https://github.com/anza-xyz/agave/releases/download/v2.3.0/solana-release-$TOOL_TARGET.tar.bz2" -o .tools/downloads/solana.tar.bz2
  tar -xjf .tools/downloads/solana.tar.bz2 -C .tools
fi
if [[ ! -f .wallets/deployer.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile .wallets/deployer.json
fi
bash scripts/check-tools.sh
node scripts/ensure-program-key.mjs "$PROGRAM_KEY_MODE"
echo 'Tools ready. Once the program key is ready, run npm run anchor:build to build the program and regenerate its client.'
