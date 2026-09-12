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
