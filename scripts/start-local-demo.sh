#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

NEXT_COMMAND=dev
if [[ $# -eq 1 && "$1" == "--production" ]]; then
  NEXT_COMMAND=start
elif [[ $# -ne 0 ]]; then
  echo "Usage: npm run demo:local [-- --production]" >&2
  exit 1
fi

if [[ ! -f target/deploy/accountability.so ]]; then
  echo "Build the program first: npm run anchor:build"
  exit 1
fi
if ! command -v solana-test-validator >/dev/null 2>&1; then
  echo "Install the project tools first: npm run tools:setup"
  exit 1
fi

# Refuse occupied ports rather than attaching to another demo or test process.
node --input-type=module <<'NODE'
import { createServer } from 'node:net';
for (const port of [3001, 18999, 19000, 19900]) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => server.close(resolve));
  } catch {
    console.error(`Port ${port} is in use. Stop that process before starting the local rehearsal.`);
    process.exit(1);
  }
}
NODE

PROGRAM_ID="$(node -p 'require("./src/lib/anchor/generated/accountability.json").address')"
LEDGER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/solara-local-demo.XXXXXX")"
VALIDATOR_PID=""
NEXT_PID=""

cleanup() {
  trap - EXIT INT TERM
  [[ -z "$NEXT_PID" ]] || kill "$NEXT_PID" 2>/dev/null || true
  [[ -z "$VALIDATOR_PID" ]] || kill "$VALIDATOR_PID" 2>/dev/null || true
  [[ -z "$NEXT_PID" ]] || wait "$NEXT_PID" 2>/dev/null || true
  [[ -z "$VALIDATOR_PID" ]] || wait "$VALIDATOR_PID" 2>/dev/null || true
  rm -rf -- "$LEDGER_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting a fresh local Solana chain for UI rehearsal."
echo "Program: $PROGRAM_ID"
solana-test-validator \
  --ledger "$LEDGER_DIR" \
  --bind-address 127.0.0.1 \
  --rpc-port 18999 \
  --faucet-port 19900 \
  --gossip-port 18800 \
  --dynamic-port-range 18801-18830 \
  --bpf-program "$PROGRAM_ID" target/deploy/accountability.so \
  --quiet >"$LEDGER_DIR/startup.log" 2>&1 &
VALIDATOR_PID=$!

if ! node --input-type=module - "$PROGRAM_ID" "$VALIDATOR_PID" <<'NODE'
const [program, validatorPid] = process.argv.slice(2);
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    process.kill(Number(validatorPid), 0);
  } catch {
    console.error('The local validator stopped during startup.');
    process.exit(1);
  }
  try {
    const response = await fetch('http://127.0.0.1:18999', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [program, { encoding: 'base64', commitment: 'confirmed' }],
      }),
      signal: AbortSignal.timeout(1_000),
    });
    const body = await response.json();
    if (body.result?.value?.executable) process.exit(0);
  } catch {
    // The validator takes a few seconds to initialize its ledger and RPC.
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
console.error('The local validator did not become ready within a minute.');
process.exit(1);
NODE
then
  tail -n 30 "$LEDGER_DIR/startup.log"
  exit 1
fi

echo "Local program ready. Open http://localhost:3001 in two browser profiles."
echo "Use Start demo to receive local test SOL. Pots reset when this command stops."
echo "This rehearsal uses localnet; the final presentation still requires devnet verification."

export NEXT_PUBLIC_SOLANA_NETWORK=localnet
export NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:18999
export NEXT_PUBLIC_SOLANA_WS_URL=ws://127.0.0.1:19000
export NEXT_PUBLIC_PRIVY_APP_ID=
export SOLARA_DEMO_FUNDER_KEYPAIR=
export NEXT_DIST_DIR=.next-local

if [[ "$NEXT_COMMAND" == "start" ]]; then
  echo "Building the production interface for this local rehearsal."
  node node_modules/next/dist/bin/next build &
  NEXT_PID=$!
  wait "$NEXT_PID"
  NEXT_PID=""
fi

node node_modules/next/dist/bin/next "$NEXT_COMMAND" --hostname 127.0.0.1 --port 3001 &
NEXT_PID=$!
wait "$NEXT_PID"
