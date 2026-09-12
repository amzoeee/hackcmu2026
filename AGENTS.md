# Accountability Staking App — Prototype

A web app where a group stakes SOL on whether someone completes a task by a deadline. A named judge decides the outcome, and the pot pays out.

**Definition of done:** in two browser profiles on devnet, one person creates a pot and stakes, another joins the opposite side, and the judge settles after the deadline. SOL visibly moves. The demo runs entirely through the UI with funded wallets and a short deadline.

Prioritize shipping that flow. Keep implementation simple, and avoid work that does not help it run reliably.

## Core decisions

- Solana devnet, native SOL, and one Rust/Anchor program with create, join, and settle operations.
- Next.js and TypeScript frontend with wallet connection and an Anchor client. Start from the `create-solana-dapp` Next.js scaffold where useful; reuse existing setup rather than recreating it.
- One page for connecting a wallet, creating and listing pots, joining, and settling.
- On-chain accounts are the source of truth. Read pots directly from the program; no database, separate backend, or additional authentication. The connected wallet identifies the user.
- Fixed stake per pot, chosen at creation. At most 10 participants total, each joining one side once.
- One judge, named at creation, manually decides whether the task was completed after the deadline.
- Settlement pays all winners in one transaction; no separate claim flow.

Out of scope: peer voting, USDC/SPL tokens, variable stakes, automated settlement, proof uploads, notifications, comments, profiles, and protocol fees. This is a devnet prototype for a trusted group, not a mainnet product or a system designed to resist collusion.

## Current implementation status

- The Anchor program implements `create_pot`, `join_pot`, and `settle_pot` in `programs/accountability/src/lib.rs`.
- Pots are PDAs derived from `['pot', creator, identifier]`. Each account stores its creator, judge, task (160 UTF-8 bytes maximum), fixed stake, deadline, creation time, YES/NO wallet lists, and settlement outcome. It has room for 10 total participants.
- Joins transfer native SOL into the program-owned pot account. Settlement validates the ordered remaining accounts against recorded recipients, pays the selected side equally, refunds everyone if the selected side is empty, and preserves account rent plus any division dust. New pots allocate space for ten wallets total; settlement uses the actual account size to preserve rent for older, larger pots too.
- `src/components/solara-app.tsx` reads every pot directly from the program, including before login, and refreshes pots and balances after confirmed transactions and every eight seconds. It includes quick deadlines, pot filters, shareable links, participant lists, wallet-address copying, and a payout review before settlement. Deployment and request failures are visible, and unavailable actions are disabled.
- Public reads have bounded waits and avoid overlapping background polls, so slow RPC responses can still reach the page. Refreshing after a confirmed action does not hold the UI pending. Keep wallet approval and signed transaction submission separate from read timeouts; uncertain transaction results retain a transaction link.
- `src/components/wallet-experience.tsx` selects the signer path. On devnet, optional Privy email/Google login creates an embedded wallet; otherwise each browser profile gets a persistent demo key, with an extension available as a secondary option. Wallet choice and sign-out survive reload without deleting the demo key.
- `src/app/api/demo-funds/route.ts` gives a low-balance demo wallet 0.25 test SOL and checks confirmation. Devnet verifies the RPC's genesis hash before using the public faucet or server-only `SOLARA_DEMO_FUNDER_KEYPAIR`. Explicit localnet with a loopback RPC uses the local faucet and ignores that key. Other networks are rejected; never configure a mainnet keypair.
- `npm run demo:local` starts an isolated local validator and loopback web server for UI rehearsal. Localnet has separate browser keys and no Privy/extension onboarding. The temporary ledger resets when the command stops; devnet remains the presentation target.
- `npm run dev:lan` and `npm run start:lan` bind Next.js to `0.0.0.0` so separate browsers and devices on the same LAN can use one host.
- `npm run demo:check` verifies the RPC is devnet and reports program deployment, the current deployer address and balance, funder reserve, and LAN URL. It exits unsuccessfully until the on-chain prerequisites are met.
- The frontend is intentionally restrained: flat light surfaces, one blue action color, system fonts, crisp borders, and 8px-based spacing. Do not add gradients, glow, decorative shadows, oversized type, or rounded data pills.
- Local program tests cover exact UTF-8 limits, insufficient funds, duplicate/late/full-pot joins, early/unauthorized/repeated settlement, recipient validation, YES and NO payouts, one-sided refunds, empty pots, and exact rent/dust preservation. Rejected operations must leave state and balances unchanged.
- `npm test` explicitly overrides Anchor's devnet provider with localnet. `npm run check` runs lint, standalone TypeScript checking, and the production build. Next's built-in checker is disabled in `next.config.ts` because Next 16.3 cannot parse TypeScript 5.9's valid `--showConfig` output; do not remove the standalone typecheck from `npm run check`.
- The release profile is size-optimized and the program crate is `cdylib` only, enabling LTO. Allow roughly 0.9 devnet SOL for deployment, or 1.5 SOL total if the host will fund two demo users.
- `.wallets/accountability-program.json` preserves the program identity outside build output. Setup and build restore its target copy and reject mismatches across the key, Rust declaration, Anchor networks, and generated clients. Creating an independent address requires the explicit `npm run tools:setup -- --new-program` command when no key is present. Devnet deployment rebuilds and validates first; never silently rotate a program key.
- Clean `npm ci` works with Solana Kit 5, which satisfies Privy's peer dependencies. Avoid forced peer-dependency overrides or broad SDK upgrades without verification.
- The full two-browser UI flow passed on localnet: separate funding, create, opposite-side joins, judge review and settlement, visible payout, and automatic cross-browser refresh. See `docs/browser-verification.md` for the observed balances. Devnet deployment and the final devnet UI run remain blocked by the unfunded deployer; use `npm run demo:check` for its current address and readiness.
- For a reliable devnet presentation, fund `.wallets/deployer.json` and set `SOLARA_DEMO_FUNDER_KEYPAIR=.wallets/deployer.json`; otherwise funding depends on the rate-limited public faucet. Pre-fund both participant wallets and repeat the complete flow on devnet before calling the prototype finished.

## Data model and behavior

Use one program-owned pot account to hold state and staked SOL. Its rough model includes:

- Creator and judge wallet addresses
- Short task description, fixed stake amount, and deadline
- YES participants (task will be completed) and NO participants (task will not be completed)
- Settlement status and outcome, so the UI can display the result
- An identifier that allows one creator to make multiple pots

Exact field types, account sizing, PDA seeds, instruction signatures, error names, and client organization are implementation choices. Keep text bounded and allocate enough space for the chosen model and all 10 participants, regardless of side.

**Create:** set the task, stake, future deadline, and judge. The creator does not automatically stake; they join like everyone else.

**Join:** before the deadline, a wallet chooses YES or NO and transfers the fixed stake into the pot. Reject duplicate participation, full pots, and settled pots.

**Settle:** only the named judge can settle, only after the deadline, and only once. Split the staked pool equally among participants on the selected side. If that side has no participants, refund everyone. An empty pot should settle without a payout. Preserve account rent and leave any rounding dust in the pot. Validate payout recipients against the recorded participants.

## Frontend flow

- Connect a wallet and show its SOL balance so staking and payouts are visible.
- Create a pot with task text, stake in SOL, deadline, and judge address.
- List pots, with newer pots first. Each card shows the task, stake, deadline or time remaining, participant counts, and settlement status/outcome.
- Offer YES/NO join actions while joining is allowed and the wallet has not already joined.
- Offer completed/not-completed settlement actions to the judge after the deadline.
- Clearly distinguish settled pots and refresh account data and balances after confirmed transactions.

Handle a disconnected wallet, insufficient SOL, an empty pot list, pending transactions, and rejected or failed transactions. Keep UI state and dependencies minimal; elaborate loading states and optimistic updates are unnecessary for this demo.

## Build and verify

Work toward these checkpoints without treating them as a rigid schedule:

1. Anchor environment builds and a basic local test passes.
2. Pot creation, joining, and settlement work in program tests.
3. Deploy to devnet and verify the transaction flow there.
4. Connect the page to the program and complete the two-profile demo.

Before relying on the UI, test creation and validation, payouts for both outcomes, duplicate/late/full-pot joins, early/unauthorized/repeated settlement, incorrect payout recipients, and one-sided refunds. Include an empty pot and verify payouts preserve rent. Choose the test harness and timing approach that fit the project.

For the final demo, fund two wallets in advance. Wallet A creates a pot with a short deadline and itself as judge, then joins YES. Wallet B joins NO. After the deadline, A settles as completed. Verify both stakes leave the wallets and the winning payout reaches A, accounting for fees and rent. Run this end to end through the UI before calling the prototype finished.
