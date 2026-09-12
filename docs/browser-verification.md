# Browser verification — 2026-09-12

The complete flow was exercised through the interface on an isolated local Solana validator using `npm run demo:local`. Wallet A used the Codex browser, and wallet B used Chrome. This verifies the local rehearsal; deployment and the same UI flow on devnet remain pending devnet funding.

## Observed balances

Both profiles created separate browser wallets and received 0.25 local test SOL through **Start demo**. A created the pot and named itself judge. The fixed stake was 0.01 SOL.

| UI action                               | Wallet A (SOL) | Wallet B (SOL) |
| --------------------------------------- | -------------: | -------------: |
| Both wallets funded                     |     0.25000000 |     0.25000000 |
| A creates pot                           |     0.24270788 |     0.25000000 |
| A joins YES                             |     0.23270288 |     0.25000000 |
| B joins NO                              |     0.23270288 |     0.23999500 |
| A confirms Completed after the deadline |     0.25269788 |     0.23999500 |

A received the full 0.02 SOL pool, less its settlement fee. Creation retained account rent in the pot. Each create, join, and settle transaction charged a 0.000005 SOL fee. Both browsers converged on the settled state through automatic polling.

Also exercised: empty-form validation, cancelling settlement review before confirming, absence of judge controls for B, and signing out followed by reload without an unwanted automatic sign-in.

## Local ledger identifiers

- Wallet A: `4h7yKVVWgYqkLcGoGLzXSFmQVpyDBzh1LuZvfubgsjdX`
- Wallet B: `8YFJwh2yL2YgG8ck8rfwJhqq6yVXoL85PGVU64boykjB`
- Pot: `EKKfR5dpXqkDyGWswroCwg6d5sV2jt2TSrh9YEwHdNez`
- Settlement: `3wUWQPLNwUd8C8G9Ge3QwBLjYAX3QN91BYx56PnwM6qVXDgSM2fVY8ytj6kexk9NBv6EkqbfsBP5xr2795fD9w8P`

These are local ledger records, not public devnet transactions. The rehearsal ledger is discarded when the command stops. Repeat the flow on devnet with funded wallets before calling the presentation ready.
