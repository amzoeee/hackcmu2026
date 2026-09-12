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

## Additional browser checks

A fresh rehearsal with the synchronized program key also exercised these cases through the UI:

| Scenario         | Balance before (SOL) | Balance after (SOL) | Result                                                                    |
| ---------------- | -------------------: | ------------------: | ------------------------------------------------------------------------- |
| NO-side winner   |           0.22541076 |          0.24540576 | Received the 0.02 SOL pool less the settlement fee                        |
| Empty pot        |           0.23270288 |          0.23269788 | Only the settlement fee was charged                                       |
| One-sided refund |           0.20540076 |          0.22539576 | The only participant recovered the 0.02 SOL stake less the settlement fee |

The page also passed a 390px mobile layout check, filtered empty states, insufficient-funds recovery, and shorthand decimal stake entry. Sharing a pot exposed a copyable link; opening it in the second profile selected and focused the correct pot even through an active-only filter. Expanded participant records showed both wallets on their recorded sides. A deliberately mismatched devnet/local RPC configuration displayed an error, disabled creation, and rejected funding with HTTP 403. The extension chooser's labeled close controls and Escape dismissal were exercised; no extension wallet was installed for a signing test.

## Separate judge and smaller accounts

After reducing the account allocation, a fresh UI rehearsal created a 599-byte pot with a 0.00505992 SOL local rent reserve. Wallet B created it, named wallet A as judge, and joined YES with 0.01 SOL. A did not stake. The pot appeared under A's **My pots**, and only A received settlement controls after the deadline.

| UI action           | Judge A (SOL) | Participant B (SOL) |
| ------------------- | ------------: | ------------------: |
| Both wallets funded |    0.25000000 |          0.25000000 |
| B creates pot       |    0.25000000 |          0.24493508 |
| B joins YES         |    0.25000000 |          0.23493008 |
| A settles Completed |    0.24999500 |          0.24493008 |

The judge paid only the settlement fee, and the participant received the full staked pool. Both browsers displayed the outcome and updated balances automatically. Earlier balance tables above used the original, larger account allocation; devnet rent may differ from the local validator's rent.

## Slow connection recovery

A controlled RPC proxy delayed reads by ten seconds, then stopped answering, then recovered. Browser checks confirmed that slow responses rendered despite the eight-second poll interval, stalled reads ended after fifteen seconds, the refresh control became available, and the last loaded pot stayed visible. Restoring the connection cleared the error. Separate form checks rejected a 164-byte emoji task, an invalid judge address, and a past deadline without moving SOL.

## Production build

The compiled production app also passed the full two-profile flow on localnet with fresh browser wallets. Both began with 0.25 SOL. After creation and a YES stake, A held 0.23493008 SOL; B held 0.239995 SOL after joining NO. A settled Completed and finished with 0.25492508 SOL, receiving the 0.02 SOL pool less the settlement fee. Both profiles displayed the settled result automatically, and neither browser reported console warnings or errors during the flow.

## Local ledger identifiers

- Wallet A: `4h7yKVVWgYqkLcGoGLzXSFmQVpyDBzh1LuZvfubgsjdX`
- Wallet B: `8YFJwh2yL2YgG8ck8rfwJhqq6yVXoL85PGVU64boykjB`
- Pot: `EKKfR5dpXqkDyGWswroCwg6d5sV2jt2TSrh9YEwHdNez`
- Settlement: `3wUWQPLNwUd8C8G9Ge3QwBLjYAX3QN91BYx56PnwM6qVXDgSM2fVY8ytj6kexk9NBv6EkqbfsBP5xr2795fD9w8P`

These are local ledger records, not public devnet transactions. The rehearsal ledger is discarded when the command stops. Repeat the flow on devnet with funded wallets before calling the presentation ready.
