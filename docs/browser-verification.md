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

Startup funding now completes before publishing a new wallet to the page. A fresh browser wallet showed **Starting…**, then its funded 0.25 SOL balance without the earlier stale-zero interval. A controlled funding failure still connected the wallet, displayed the original recovery message, and left **Add test SOL** available for another attempt.

A separate proxy withheld only blockhash preparation reads. Create and Join released the interface after fifteen seconds with no SOL moved. Restoring RPC allowed creation; a later stalled join crossed the deadline without submitting a stake. The empty pot then settled normally, changing its judge's balance from 0.24493508 to 0.24493008 SOL for the fee alone. The interface displayed clear preparation/retry guidance and cleared unrelated transaction links when wallet-copy or funding feedback appeared.

A submission proxy forwarded a signed create transaction to the validator but withheld its response. The pot appeared once through polling. After sixty seconds, the interface released the pending controls, kept the signed transaction's link, and explained that the action may already have succeeded. Direct RPC inspection confirmed one successful creation and one fee. After restoring responses, the wallet joined the existing pot and settled the opposite side for a refund; its balance changed from 0.23493008 to 0.24492508 SOL. The review named the exact 0.01 SOL refund, and the final receipt matched it.

Pot: `CeMX9WfT288eVtdrp3hHwixBreT23M2pwZRPPH6eAsSd`. Refund settlement: `FMpmgV9d7zdKw8VxBubivc5EvhNpmndyLrDHm5j5a6qJEy4qQoSLAieRorkaF4ivxrYSg2k9jWyEAgA6cZ7hywJ`.

Two tabs sharing the same wallet submitted opposite-side joins before either tab refreshed. Both transactions landed in the same slot: YES transferred one 0.01 SOL stake, while NO failed with `AlreadyParticipating` and transferred no stake. The wallet paid two 0.000005 SOL fees, moving from 0.24479024 to 0.23478024 SOL. Both tabs converged to one YES participant, no NO participants, and a 0.01 SOL pool; the rejected tab displayed the reason.

Pot: `89i8hMYaVj4uqgN6RXcbeeLvze7ziXvQFwrvR2YmWeZ9`. Successful join: `4rBNUk8QaNuC8Yag9uVfM6M1dSL9WxS3WzvnHacuzGEx8ov7WBoMYJeWZhkqZ3HSMkyqkmyPUbFDFiWRHhb7Hx6A`.

## Production build

The compiled production app also passed the full two-profile flow on localnet with fresh browser wallets. Both began with 0.25 SOL. After creation and a YES stake, A held 0.23493008 SOL; B held 0.239995 SOL after joining NO. A settled Completed and finished with 0.25492508 SOL, receiving the 0.02 SOL pool less the settlement fee. Both profiles displayed the settled result automatically, and neither browser reported console warnings or errors during the flow.

A repeat with the updated payout text verified that the review and winner receipt both identify the 0.02 SOL share as including the original stake. Sharing from a URL containing a query string produced a clean pot link without that query string and retained the local-sharing guidance.

Opening the production devnet page through the host's HTTP LAN address verified browser-wallet creation, restoration after reload, and the manual address-copy fallback when clipboard access was unavailable. This check used the same computer and a disabled test funder; a second physical device and the full devnet staking flow remain unverified.

## Full-capacity browser rehearsal

The production rehearsal also passed a ten-wallet pot with five YES and five NO participants. Two browser profiles and eight temporary loopback origins provided independent browser wallet storage; every wallet was created, funded, and joined through the interface. The task used the full 160-byte allowance.

After ten 0.01 SOL stakes, every client showed **Full**, a 0.1 SOL pool, and the complete participant list. An eleventh visitor saw disabled join controls. The full task, expanded addresses, and share controls fit a 320px viewport without horizontal overflow.

After the deadline, the judge reviewed and confirmed the five-winner payout. Each additional YES wallet moved from 0.239995 to 0.259995 SOL; each additional NO wallet remained at 0.239995 SOL. The judge's balance moved from 0.21986016 to 0.23985516 SOL, reflecting its 0.02 SOL payout less the settlement fee. All ten clients displayed the matching personal outcome automatically.

Pot: `8aYL8hCsTWZyzyjqpoAkoHLbKfRFcB8918yk7ZjUE53T`. Settlement: `scUeSc7YFrHVP9277NcpT8TYqVEpDHTb8h4SzignJGsEJLimeBx1GCfSt1VnffN7TVU7QDGaVSgabNZ8ArPkMDF`.

## Hour-long rehearsal

The production server and two primary browser profiles stayed running for an hour while other pots were created and settled. Both original 0.01 SOL stakes remained recorded throughout. At the deadline, only the named judge received settlement controls. Completing the pot changed the judge's balance from 0.23985516 to 0.25985016 SOL, paying the 0.02 SOL pool less the 0.000005 SOL fee; the NO participant stayed at 0.22999 SOL. Both profiles showed the settled result automatically.

Pot: `6DmcqiBT7QRLyH8keo3pgDhe1dA9pRQZNoAdHbU7MjDw`. Settlement: `4cz3LUQN2K8eqVJFuDAt8rEWcxFrs9TtvQtrsMENxZhdCizLKArmCqnjizK7jwu51gRpBMy5YNpTohGs58NZTpZx`.

## Keyboard and outcome status

On the compiled interface, opening **Not completed**, tabbing to **Cancel**, and pressing Enter now returns focus to **Not completed**. Before the fix, focus fell back to the page. A later NO-side settlement updated the other profile's personal result in a status region while its focus stayed in the task field. The winner's balance rose from 0.239995 to 0.259995 SOL; the judge paid only the 0.000005 SOL settlement fee.

Pot: `5txTaNASwXn3cY3gmqqxMxvinRqAvJy1JMPcHHV6K27M`. Settlement: `4SuTj5nJDxgJq3RKeFLdUsqoz4XcWHjAEoHBFbXt8oRDbhMYYPcvQdU1tsbsixewgYJ21dtoaTTnNtdngS7kKkTQ`.

The final markup also disables creation fields during submission and adds larger mobile wallet/deadline targets. Their dedicated delayed-form and mobile checks remain incomplete: the viewport override did not apply, and a later browser-control call stalled beyond the work deadline. The keyboard and status checks above were completed; no screen-reader audio test was performed.

## Original local ledger identifiers

- Wallet A: `4h7yKVVWgYqkLcGoGLzXSFmQVpyDBzh1LuZvfubgsjdX`
- Wallet B: `8YFJwh2yL2YgG8ck8rfwJhqq6yVXoL85PGVU64boykjB`
- Pot: `EKKfR5dpXqkDyGWswroCwg6d5sV2jt2TSrh9YEwHdNez`
- Settlement: `3wUWQPLNwUd8C8G9Ge3QwBLjYAX3QN91BYx56PnwM6qVXDgSM2fVY8ytj6kexk9NBv6EkqbfsBP5xr2795fD9w8P`

These are local ledger records, not public devnet transactions. The rehearsal ledger is discarded when the command stops. Repeat the flow on devnet with funded wallets before calling the presentation ready.
