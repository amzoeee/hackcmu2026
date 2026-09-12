# Recovery and group challenge verification

## Local browser rehearsal — 2026-09-12

The updated interface and program passed through three independent browser wallets on an isolated local validator. Wallet A used Chrome at `127.0.0.1`; B used the in-app browser at the same origin; C used a separate `localhost` storage origin. All wallets began with 0.25 local test SOL. Actions were performed through the UI; RPC reads only collected final evidence.

- **Unopposed failure:** B created a 0.01 SOL pot with A as judge, then joined YES. The badge and warning appeared. After the deadline, A reviewed and confirmed not-completed; A received the 0.01 SOL stake, less A's 0.000005 settlement fee.
- **Timeout:** A created a 0.01 SOL pot and joined YES; B joined NO. After the deadline and five-minute grace window, C (neither participant nor judge) used **Refund all stakes**. A and B each received exactly 0.01 SOL. C paid only the 0.000005 transaction fee. The pot became settled with no outcome, and both participant receipts updated automatically.
- **Group:** A created two friend tasks in one transaction, then staked NO in both in a second transaction. B and C opened the shared group and joined YES on their own tasks. Tags were hidden, and the intended friend was identified. Reloading A and using **Resume group setup** verified the two existing pots and NO stakes without submitting another transaction.
- **Independent verdicts:** after the shared deadline, A settled B's task as completed and C's task as not completed. B received its 0.02 SOL pool; A received C's separate 0.02 SOL pool. Both browsers displayed the independent outcomes and payouts.

Every settled pot retained exactly 5,059,920 lamports of rent. Final wallet balances were A: 0.24478524 SOL, B: 0.24492008 SOL, C: 0.23999 SOL. The [local evidence](local-recovery-verification.json) records accounts, outcomes, recipient lists, balances, and transaction IDs. These IDs belong to the discarded local ledger, not a public explorer.

## Automated checks

`npm test` passed all three Rust unit tests and all 19 local-validator tests, including exact grace boundaries and five independently settled group pots. `npm run test:offchain` passed all 20 tests, including uncertain-submission recovery. `npm run check` passed lint, standalone TypeScript, and the production build.
