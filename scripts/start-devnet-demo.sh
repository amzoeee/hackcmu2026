#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

NEXT_COMMAND=dev
if [[ $# -eq 1 && "$1" == "--production" ]]; then
  NEXT_COMMAND=start
elif [[ $# -ne 0 ]]; then
  echo "Usage: npm run demo:devnet [-- --production]" >&2
  exit 1
fi

export NEXT_PUBLIC_SOLANA_NETWORK=devnet
# Leave the RPC and WebSocket URLs to the environment and .env.local so a host
# can present on a private devnet endpoint. Unset, they default to the public
# devnet RPC, and the readiness check below verifies the genesis hash either way.
export NEXT_PUBLIC_PRIVY_APP_ID=
export SOLARA_DEMO_FUNDER_KEYPAIR=.wallets/deployer.json
export NEXT_DIST_DIR=.next-devnet

node --input-type=module <<'NODE'
import { createServer } from 'node:net';
const server = createServer();
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3002, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
} catch {
  console.error('Port 3002 is in use. Stop that process before starting the devnet demo.');
  process.exit(1);
}
NODE

bash scripts/check-demo-readiness.sh

if [[ "$NEXT_COMMAND" == "start" ]]; then
  echo "Building the production interface for the devnet demo."
  node node_modules/next/dist/bin/next build
fi

echo "Starting the devnet demo at http://127.0.0.1:3002."
echo "Use Start demo in two browser profiles to receive devnet test SOL."
exec node node_modules/next/dist/bin/next "$NEXT_COMMAND" --hostname 127.0.0.1 --port 3002
