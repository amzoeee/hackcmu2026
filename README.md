# Solara — accountability staking

A prototype where a trusted group stakes test SOL on whether someone completes a task. A named judge settles after the deadline, and winners receive the pot in one transaction.

The on-chain program and the complete two-browser flow have passed on a local Solana validator. **Devnet presentation verification is still pending:** the deployer needs test SOL before the program can be deployed. Run `npm run demo:check` for the current addresses, balances, and readiness. The [browser verification record](docs/browser-verification.md) contains the observed local payouts.

## Setup

Use Node.js 22 or newer and npm. On macOS, install Xcode Command Line Tools with `xcode-select --install` if needed. Linux needs native compiler and linker tools.

```sh
npm ci
npm run tools:setup
npm run anchor:build
```

The setup installs the project's Rust, Solana, and Anchor tools into ignored local folders. First-time setup needs internet access. The lockfile uses Solana Kit 5 to satisfy Privy's peer dependencies; ordinary `npm ci` works without dependency overrides.

On a fresh checkout, restore the existing program key to `.wallets/accountability-program.json` before building. To intentionally create an independent program address when no program key is present, run `npm run tools:setup -- --new-program`, then build. Setup and builds preserve existing keys and reject mismatched addresses.

No database, Docker, separate backend, wallet extension, or real SOL is required for the local rehearsal.

## Rehearse the full flow locally

```sh
npm run demo:local
```

For the compiled interface without development controls, use `npm run demo:local -- --production`. It builds the local configuration before starting the same rehearsal.

Open [http://localhost:3001](http://localhost:3001) in two separate browser profiles. The command starts an isolated local validator with the built program and a local-only web server. It uses its own build directory and does not change devnet environment settings. Press **Ctrl+C** to stop both processes and discard the temporary ledger; pots reset on the next run.

The temporary ledger retains recent transaction history for reviewing payouts during a presentation.

1. In each profile, click **Start demo**. Each wallet receives 0.25 local test SOL.
2. In profile A, enter a task, use a 0.01 SOL stake and a short deadline, and leave the judge blank to judge it yourself. Create the pot.
3. A joins **YES**. B joins **NO** on the same pot. Both balances decrease by the stake plus a small fee.
4. After the deadline, A selects **Completed**, reviews the payout, and confirms settlement. A receives the 0.02 SOL pool; both browsers show the settled result automatically.

Localnet wallets use separate browser storage from devnet wallets. Local funding only works with an explicitly configured localnet and a loopback RPC, and it ignores any devnet funder key. Privy and wallet-extension onboarding remain devnet-only. Local rehearsal does not replace the final devnet check.

The web page binds to localhost. The bundled Solana validator exposes its RPC and faucet listeners on network interfaces despite its local bind option, so run the rehearsal on a trusted network.

Browser keys survive a local restart, so use **Add test SOL** to fund restored wallets on the new chain.

## Run and present on devnet

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public devnet RPC is the default; no environment file is required. **Start demo** creates a persistent wallet in that browser profile and requests 0.25 devnet SOL. Signing out preserves the key, and signing back in restores the same wallet. Two ordinary tabs in one profile share a wallet; use separate profiles or devices for separate participants.

The page includes quick deadlines, pot filters, shareable pot links, participant lists, transaction links, and a payout review before settlement. Copy a wallet address from the header when naming another judge. Pot state comes directly from the program, including before login, and pots and balances refresh every eight seconds. Creating a pot pays account rent and a network fee; the creator stakes separately. Tasks are limited to **160 UTF-8 bytes**, and each pot allows at most 10 participants at one fixed stake.

If a transaction's submission response is lost, the page keeps its transaction link and releases the controls. Check that transaction and refresh the pots and wallet balance before retrying: it may already have succeeded. Settlement reviews and winner receipts show each recipient's share of the staked pool, including the original stake.

Before presenting:

```sh
npm run demo:check
# Fund the deployer printed by the check, then:
npm run anchor:deploy:devnet
npm run demo:check
```

The current optimized program needs roughly 0.9 devnet SOL to deploy. Allow about 1.5 SOL total if that wallet will also fund two participants. Deployment rebuilds the program and verifies its key, configuration, and generated client addresses first. The readiness check requires a configured host funder with at least 0.6 SOL in reserve because public faucet availability cannot be verified. Require `Demo ready: yes`, fund both participant wallets in advance, and repeat the two-profile flow above on devnet.

The [MLH Solana resources](https://www.mlh.com/partners/solana) link to the [official devnet faucet](https://faucet.solana.com/). Use the printed deployer address when funding deployment; local rehearsal SOL cannot be transferred to devnet. The faucet currently requires both GitHub sign-in and browser verification, even though the page describes GitHub as unlocking a higher limit. Its GitHub authorization requests read-only profile and email access.

If the public faucet is rate-limited, set a funded, server-only devnet keypair in `.env.local`:

```sh
SOLARA_DEMO_FUNDER_KEYPAIR=.wallets/deployer.json
```

The funding route verifies the RPC's devnet identity before funding, adds 0.25 test SOL to low-balance wallets, and checks transaction confirmation. Requests time out cleanly; check the wallet balance before retrying because a submitted transfer may still arrive. Never use a mainnet keypair or put private-key contents in a `NEXT_PUBLIC_` variable. See `.env.example` for custom devnet RPC and WebSocket settings; restart the server after changes.

For email or Google login, configure a Privy app and set `NEXT_PUBLIC_PRIVY_APP_ID`. Enable the desired login methods and allow the origins used for the demo. Without Privy, the built-in browser wallet and **Use wallet extension** are available. Extensions must use devnet.

For participants on the same LAN:

```sh
npm run dev:lan
# Or use a production build:
npm run build
npm run start:lan
```

Share the host's LAN URL printed by `npm run demo:check` and allow inbound port 3000 if needed. The local rehearsal command stays on loopback; use the devnet server for LAN participation.

## Verify changes

```sh
npm run check       # Lint, standalone TypeScript check, production build
npm test            # Build and test on a temporary local validator
npm run tools:check # Verify the installed toolchain
```

Program tests cover creation and exact UTF-8 limits, insufficient funds, duplicate/late/full-pot joins, judge and deadline restrictions, invalid payout recipients, payouts for both sides, one-sided refunds, empty pots, and exact rent/dust preservation. Maximum-size pots are tested with all ten wallets on either side and with mixed sides. Rejected operations are checked for unchanged balances and state. Browser verification covers the actual create/join/settle flow and recovery controls.

Funding endpoint tests also verify the actual devnet identity before faucet or host-key use, failed confirmations, repeat requests, and recovery after RPC failure. Run these alone with `node --import tsx --test tests/demo-funds.test.ts`.

GitHub checks each push and pull request with a clean install, frontend checks, funding tests, and slow/unavailable RPC recovery tests. On-chain tests and the two-browser rehearsal still run locally.

Keep the standalone TypeScript check: Next's built-in checker is disabled because this Next/TypeScript combination rejects valid compiler configuration output. Upstream wallet SDK dependencies still have npm audit findings; do not use forced dependency upgrades without validating wallet behavior.

## Project map

| Area                                        | Location                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| One-page UI and transaction flow            | `src/components/solara-app.tsx`                                              |
| Wallet selection and providers              | `src/components/wallet-experience.tsx`, `src/components/wallet-provider.tsx` |
| Browser demo keys and network configuration | `src/lib/demo-wallet.ts`, `src/lib/solana.ts`                                |
| Test SOL funding endpoint                   | `src/app/api/demo-funds/route.ts`                                            |
| Styling                                     | `src/app/globals.css`                                                        |
| Anchor client and generated types           | `src/lib/anchor/`                                                            |
| On-chain program                            | `programs/accountability/src/lib.rs`                                         |
| Program tests                               | `tests/accountability.test.ts`                                               |
| Tooling, deployment, and rehearsal commands | `scripts/`                                                                   |
| Prototype scope and working instructions    | `AGENTS.md`                                                                  |

Run `npm run anchor:build` to regenerate the client after Rust changes; do not edit `src/lib/anchor/generated/` by hand. Keep generated clients in Git so frontend-only installs can build. Never commit `.wallets/`, `.tools/`, or `target/`. Back up `.wallets/accountability-program.json` and the deployer key privately; the copy under `target/deploy/` is restored automatically from the durable program key.
