# Finance your Responsibilities — Prototype

A web app where a group stakes SOL on whether someone completes a task by a deadline. A named judge decides the outcome, and the pot pays out.

**Definition of done:** in two browser profiles on devnet, one person creates a pot and stakes, another joins the opposite side, and the judge settles after the deadline. SOL visibly moves. The demo runs entirely through the UI with funded wallets and a short deadline.

Prioritize shipping that flow. Keep implementation simple, and avoid work that does not help it run reliably.

## Core decisions

- Solana devnet, native SOL, and one Rust/Anchor program with create, join, settle, and timeout-refund operations.
- Next.js and TypeScript frontend with wallet connection and an Anchor client. Start from the `create-solana-dapp` Next.js scaffold where useful; reuse existing setup rather than recreating it.
- One page for connecting a wallet, creating and listing pots, joining, and settling.
- On-chain accounts are the source of truth. Read pots directly from the program; no database, separate backend, or additional authentication. The connected wallet identifies the user.
- Fixed stake per pot, chosen at creation. At most 10 participants total, each joining one side once.
- One judge, named at creation, manually decides whether the task was completed after the deadline.
- Settlement pays all winners in one transaction; no separate claim flow.

Out of scope: peer voting, USDC/SPL tokens, variable stakes, automated settlement, proof file uploads (proof links are supported), notifications, comments, and protocol fees. This is a devnet prototype for a trusted group, not a mainnet product or a system designed to resist collusion.

## Current implementation status

- The Anchor program implements `create_pot`, `join_pot`, `settle_pot`, `refund_pot`, `submit_proof`, `set_profile`, and `resize_pot` in `programs/accountability/src/lib.rs`.
- Pots are PDAs derived from `['pot', creator, identifier]`. Each account stores its creator, judge, task (160 UTF-8 bytes maximum), fixed stake, deadline, creation time, YES/NO wallet lists, settlement outcome, a proof link (`proof_uri`, 200 bytes maximum, empty at creation), and an optional invite-code hash (`access_hash`). A settled pot with no outcome means timeout refunds; keep this layout compatible with older accounts. It has room for 10 total participants and is 836 bytes.
- Joins transfer native SOL into the program-owned pot account. Settlement validates ordered payout recipients. Opposed pots pay the selected side equally. Unopposed completed pots refund exact stakes; unopposed failed pots forfeit recorded stakes to the judge, including any stake the judge contributed. A five-minute grace window closes verdicts and unlocks permissionless exact-stake refunds. Preserve rent, leave unsolicited extra SOL during refunds/forfeitures, and keep division dust for opposed payouts. New pots allocate space for ten wallets total; settlement uses the actual account size to preserve rent for older, larger pots too.
- `submit_proof(uri)` lets the pot creator or any YES participant store a proof link, before or after the deadline until settlement, and emits `ProofSubmitted` so replaced links stay in the log. Once a link is recorded only the creator may replace it (`ProofAlreadySubmitted`), so one participant cannot swap another's evidence out from under the judge. It rejects other signers (`UnauthorizedProof`), settled pots (`PotSettled`), blank links (`ProofRequired`), and links over 200 bytes (`ProofTooLong`).
- `create_pot` takes a trailing `access_hash: Option<[u8; 32]>` and `join_pot` a trailing `access_code: Option<String>` (64 bytes maximum, `AccessCodeTooLong`). The hash covers the pot address followed by the code, so it cannot be replayed against another pot and one precomputed table cannot cover every pot. `src/lib/invite-code.ts` is the only definition of that scheme: `createInviteCode` generates an 80-bit code, because the stored hash is public and a chosen code would be guessed offline, and `inviteCodeHash` rejects codes outside 8-64 bytes. A gated pot requires a matching code (`InvalidAccessCode`, also when the code is missing); an open pot ignores any supplied code. Codes travel as plain instruction data, so the first join publishes the code on the ledger for good: the gate hides a pot from people browsing the list, and settlement never depends on it. Hashing uses the `solana-sha256-hasher` crate because Anchor 0.32 does not re-export a hash module.
- `set_profile(name)` creates or overwrites a `Profile { wallet, name }` account (76 bytes) at the PDA `['profile', wallet]` using `init_if_needed` (enabled on `anchor-lang` in `programs/accountability/Cargo.toml`), paid by the signing wallet. Names must be non-blank (`NameRequired`) and at most 32 bytes (`NameTooLong`). The seeds ensure only a wallet can write its own profile.
- The page passes `null` for the new `create_pot`/`join_pot` arguments and has no interface for proof links, invite codes, or profiles yet. Its pot list uses `fetchDecodablePots` in `src/lib/anchor/client.ts`, which decodes each account individually and returns the undecodable addresses alongside the pots, instead of `program.account.pot.all()`, which fails the whole read when one account does not decode. The page names those addresses above the list, because a pot that still holds stakes must not vanish from it without explanation.
- The pot layout changed with these fields, and `POT_ACCOUNT_BYTES` in `src/lib/pot-values.ts` tracks it. Pots created by the earlier program build decode only when their account has at least five spare bytes; they then show no proof link and no invite code. A pot with ten participants and a task of 156 bytes or more filled its old 599-byte allocation, so it does not, settled or not, and neither a verdict nor a refund could move its stakes.
- `resize_pot` repairs such a pot: any signer may grow a pre-upgrade pot to the current allocation, and the payer covers the rent the added bytes need so the stakes themselves are never drawn on. It checks the owner and the `Pot` discriminator (`NotAPot`) and does nothing to a pot that is already current, so repeated or racing repairs succeed.
- The committed program ID stays `EE5h4kXh8Pk2ECthCABpK7bLQ934n4TZjkRsuDgskYBb`, but devnet still runs the previous build. The holder of the upgrade authority must upgrade it with `npm run anchor:deploy:devnet` before `submit_proof`, `set_profile`, or invite-code gating work there; if the upgrade reports the program account is too small, run `solana program extend` first. Repeat the two-browser flow after upgrading.
- `src/components/finance-your-responsibilities-app.tsx` reads every pot directly from the program, including before login, and refreshes pots and balances after confirmed transactions and every eight seconds. It includes quick deadlines, pot filters, shareable links, participant lists, wallet-address copying, and a payout review before settlement. Deployment and request failures are visible, and unavailable actions are disabled.
- The published IDL is checked once per connection for `refund_pot` and the expected grace window; a failed read leaves the previous verdict standing rather than discarding pots that loaded correctly. The judge's verdict controls and the permissionless refund hand off at one clock-drift-adjusted instant, so the judge keeps their whole on-chain window and no card is left without an action. Abandoning a group draft that still has created pots without the organizer's NO stake asks for a second confirmation, because a friend joining YES there would stake against a judge with nothing at risk.
- Public reads and transaction preparation have bounded waits. Background polls avoid overlap, so slow RPC responses can still reach the page. Refreshing after a confirmed action does not hold the UI pending. Wallet approval is not timed out; signed submission has its own longer deadline and uncertain results retain a transaction link without automatic retries. Optional log retrieval must preserve the original transaction failure when reads fail.
- `src/components/wallet-experience.tsx` selects the signer path. On devnet, optional Privy email/Google login creates an embedded wallet; otherwise each browser profile gets a persistent demo key, with an extension available as a secondary option. Wallet choice and sign-out survive reload without deleting the demo key.
- `src/app/api/demo-funds/route.ts` gives a low-balance demo wallet 0.25 test SOL and checks confirmation. Devnet verifies the RPC's genesis hash before using the public faucet or server-only `SOLARA_DEMO_FUNDER_KEYPAIR`. Explicit localnet with a loopback RPC uses the local faucet and ignores that key. Other networks are rejected; never configure a mainnet keypair.
- `npm run demo:local` starts an isolated local validator and loopback web server for UI rehearsal. Add `-- --production` to build and run the compiled interface. Localnet has separate browser keys and no Privy/extension onboarding. The temporary ledger resets when the command stops; devnet remains the presentation target.
- `npm run dev:lan` and `npm run start:lan` bind Next.js to `0.0.0.0` so separate browsers and devices on the same LAN can use one host.
- `npm run demo:check` verifies the RPC is devnet and reports program deployment, the current deployer address and balance, funder reserve, and LAN URL. It exits unsuccessfully until the on-chain prerequisites are met.
- The frontend is intentionally restrained: flat light surfaces, one blue action color, system fonts, crisp borders, and 8px-based spacing. Do not add gradients, glow, decorative shadows, oversized type, or rounded data pills.
- Local program tests cover exact UTF-8 limits, insufficient funds, duplicate/late/full-pot joins, early/unauthorized/repeated settlement, recipient validation, YES and NO payouts, one-sided refunds and forfeitures, timeout refunds, empty pots, and exact rent/dust preservation. Aged validator fixtures cover expired pots without waiting through the grace window; boundary tests cover the exact cutoff. Rejected operations must leave state and balances unchanged. They also cover proof links from the creator and a YES participant; rejected proof from a NO participant, an outsider, a blank or 201-byte link, and after settlement; invite-code joins with correct, wrong, missing, and 65-byte codes, plus open pots ignoring codes; and profile creation, overwrite, PDA read-back, invalid names, and foreign signers. Maximum-size pot tests fill the proof link and invite hash so the 836-byte allocation is exact. `tests/invite-code.test.ts` pins the hashing scheme. `scripts/create-test-fixtures.mjs` also writes a full pre-upgrade pot holding ten stakes, and a test proves it can neither be read nor refunded until `resize_pot` grows it, and that the stakes then come back exactly.
- `npm test` explicitly overrides Anchor's devnet provider with localnet. `npm run check` runs lint, standalone TypeScript checking, and the production build. Next's built-in checker is disabled in `next.config.ts` because Next 16.3 cannot parse TypeScript 5.9's valid `--showConfig` output; do not remove the standalone typecheck from `npm run check`.
- The release profile is size-optimized and the program crate is `cdylib` only, enabling LTO. Allow roughly 0.9 devnet SOL for deployment, or 1.5 SOL total if the host will fund two demo users.
- `.wallets/accountability-program.json` preserves the program identity outside build output. Setup and build restore its target copy and reject mismatches across the key, Rust declaration, Anchor networks, and generated clients. Creating an independent address requires the explicit `npm run tools:setup -- --new-program` command when no key is present. Devnet deployment rebuilds, validates, and ensures sufficient program capacity first; never silently rotate a program key.
- Clean `npm ci` works with Solana Kit 5, which satisfies Privy's peer dependencies. Avoid forced peer-dependency overrides or broad SDK upgrades without verification.
- The original program and IDL are deployed on devnet, and the original two-browser flow passed entirely through the production UI: separate funding, create, opposite-side stakes, judge settlement after a two-minute deadline, visible payout, and automatic cross-browser refresh. Localnet additionally passed a ten-wallet pot and failure-recovery checks. See `docs/browser-verification.md` for balances and public transaction links; use `npm run demo:check` for current addresses and readiness.
- `npm run demo:devnet` starts a funded browser-wallet demo on `127.0.0.1:3002`, after checking deployment and the deployer reserve. Add `-- --production` to build and serve the presentation interface. Its `.next-devnet` output is separate from ordinary development and local rehearsal builds.
- The upgraded program and matching recovery IDL are deployed on devnet, with the deployed ELF verified against the tested build. The production UI passed the standard two-wallet payout plus three-wallet recovery/group checks on both localnet and devnet: an uninvolved caller refunds exact stakes, an unopposed failure pays the judge, and grouped pots get independent verdicts. Reload/resume does not duplicate confirmed group transactions. See `docs/recovery-verification.md` for public evidence.
- `bot/` is an optional read-only Discord bot in its own npm package (Node 24, tsx, `node --test`). It reads pots through `src/lib/anchor/generated/accountability.json` at runtime, serves `/pots` and `/pot <address>`, and announces new and settled pots to one channel after seeding the known set silently at startup. `npm run dry-run` inside `bot/` prints the messages without a Discord token, root ESLint ignores `bot/**`, and root Prettier formats it. Live posting has not been verified because no Discord application or token exists yet.
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

**Settle:** only the named judge can give a verdict, from the deadline until five minutes after it, once. With both sides populated, split the pool equally among winners. With only one side populated, completed returns exact stakes and not-completed forfeits recorded stakes to the judge. An empty pot settles without payout. Preserve actual account rent and division dust; validate ordered recipients. Upgrades apply these rules to existing unsettled pots; do not infer new forfeiture payouts for historical settled pots.

**Refund:** from five minutes after the deadline, any signer may refund every original stake in YES-then-NO order. The judge can no longer give a verdict. Set `settled=true`, `outcome=None`; preserve rent and extra SOL. No close instruction or automatic scheduler.

**Group challenge:** the organizer creates one pot per friend and joins NO in each; friends join YES themselves. Use strict task-prefix metadata for display grouping and the intended participant, within the 160-byte limit. No group accounts or additional program changes. Pack creates by actual transaction size, then organizer joins, with sequential batches as needed. Show all organizer costs, preserve resumable progress, and never automatically retry an uncertain submission.

## Frontend flow

- Connect a wallet and show its SOL balance so staking and payouts are visible.
- Create a pot with task text, stake in SOL, deadline, and judge address.
- List pots, with newer pots first. Each card shows the task, stake, deadline or time remaining, participant counts, and settlement status/outcome.
- Offer YES/NO join actions while joining is allowed and the wallet has not already joined.
- Offer completed/not-completed actions during the judge window and permissionless refund-all after it. Show unopposed warnings and payout reviews before users commit.
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
