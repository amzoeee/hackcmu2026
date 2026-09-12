#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

RPC_URL="${NEXT_PUBLIC_SOLANA_RPC_URL:-https://api.devnet.solana.com}"
NETWORK="${NEXT_PUBLIC_SOLANA_NETWORK:-devnet}"
DEPLOYER_KEYPAIR=".wallets/deployer.json"
PROGRAM_ID="$(node -p 'require("./src/lib/anchor/generated/accountability.json").address')"

if [[ ! -f "$DEPLOYER_KEYPAIR" ]]; then
  echo "Demo ready: no"
  echo "Missing $DEPLOYER_KEYPAIR. Run npm run tools:setup first."
  exit 1
fi

DEPLOYER_ADDRESS="$(solana address --keypair "$DEPLOYER_KEYPAIR")"
BALANCE_OUTPUT="$(solana balance --lamports --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR")"
DEPLOYER_LAMPORTS="${BALANCE_OUTPUT%% *}"
READY=true

echo "Network: $NETWORK"
echo "RPC: $RPC_URL"
echo "Program: $PROGRAM_ID"
echo "Deployer: $DEPLOYER_ADDRESS"
echo "Deployer balance: $BALANCE_OUTPUT"

if [[ "$NETWORK" != "devnet" ]]; then
  echo "Network check: failed; this demo is configured for devnet."
  READY=false
fi

if solana program show "$PROGRAM_ID" --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" >/dev/null 2>&1; then
  echo "Program deployed: yes"
else
  echo "Program deployed: no"
  echo "Fund the deployer, then run npm run anchor:deploy:devnet."
  echo "The current program build needs roughly 1.15 SOL to deploy."
  READY=false
fi

if [[ "$DEPLOYER_LAMPORTS" -lt 600000000 ]]; then
  echo "Demo funder reserve: low"
  echo "Keep at least 0.6 SOL available if this wallet will fund two LAN guests."
else
  echo "Demo funder reserve: ready"
fi

if command -v hostname >/dev/null 2>&1 && [[ -n "$(hostname -I 2>/dev/null || true)" ]]; then
  LAN_ADDRESS="$(hostname -I | awk '{print $1}')"
  echo "LAN URL: http://$LAN_ADDRESS:3000"
else
  echo "LAN URL: http://HOST_IP:3000"
fi

if [[ "$READY" == true ]]; then
  echo "Demo ready: yes"
else
  echo "Demo ready: no"
  exit 1
fi
