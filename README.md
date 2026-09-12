# Finance your Responsibilities

Turn a promise into a shared challenge. Create a task, set a deadline, and stake SOL with friends on whether it gets done. A person you choose as judge decides the result, and the app sends the payout to the winning wallets.

This prototype runs on Solana devnet, a test network.

## Get started

1. Open the app link shared by your host. You can browse pots before connecting a wallet.
2. Select **Start demo** to create a wallet in your browser and request **0.25 test SOL**. No wallet extension is needed. Wait for your balance to appear at the top of the page.
3. If your balance is below **0.05 SOL**, select **+ Test SOL** to request another 0.25 test SOL. Funding may be temporarily unavailable; check your balance before trying again.

If the app shows **Sign in**, your host has enabled email or Google login. You can also use an existing wallet through **Connect wallet** where available; set your extension to devnet and fund it with test SOL.

Your browser demo wallet stays in the same browser profile and app address after reload or **Sign out**. Clearing that site's browser storage removes access to it. To try the app as two people on one computer, use **two separate browser profiles**.

## Create and join your first pot

A **pot** holds the stakes for one task. **YES** means you think the task will be completed by the deadline; **NO** means you think it will not.

1. Under **New pot**, choose **Single**. Enter a clear task, such as “Finish the pitch before the demo.” Keep within the task counter; emoji and some other characters use more of the limit.
2. Set **Stake (SOL)**, the amount each participant must contribute. For a first try, use **0.01 SOL**.
3. Choose a future **Deadline**. For a quick demo, manually set it a few minutes ahead so both people have time to join.
4. Enter the **Judge**'s wallet address, or leave it blank to judge the task yourself. Your friend can copy their address by clicking it at the top of their page. Agree on what counts as completion before staking.
5. Select **Create pot**. Creating pays a small network fee and an account storage deposit called rent. **It does not stake for you.**
6. On the new pot, select **Join YES** or **Join NO**. Use **Share** to send the pot link to your friend, who joins from their own wallet.

Each pot accepts up to **10 participants**, all at the same stake. You can join once, before the deadline. After joining, you cannot switch sides or withdraw your stake early. Task text, wallet addresses, and results are public.

## Decide the result and receive payouts

The named judge has **five minutes after the deadline** to settle. Using that wallet, select **Completed** or **Not completed**, review who will receive the SOL, then select **Confirm**. The verdict is final. Payouts reach recipients' wallets in the settlement transaction; there is no separate claim step.

| Who joined?               | Completed                                | Not completed                                                |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Both YES and NO           | YES participants split the pool equally. | NO participants split the pool equally.                      |
| Only one side (unopposed) | Everyone gets their original stake back. | All stakes go to the judge, regardless of which side joined. |
| Nobody                    | No payout.                               | No payout.                                                   |

**Check unopposed pots before joining.** A NO stake alone does not win on a failed task: it goes to the judge. The judge may also be a participant, so choose someone whose decision everyone trusts.

If the judge misses the window, verdicts close and **Refund all stakes** becomes available. **Any connected wallet** can select it to return every participant's original stake. The caller pays the network fee. Refunds require someone to press the button; they do not happen automatically.

## Challenge several friends

Choose **Group** under **New pot** to give 2–10 friends their own tasks and pots.

1. Enter each friend's wallet address and task, then choose a shared stake, deadline, and judge.
2. Review **Your cost**, which includes your NO stake, rent, and fees for every pot.
3. Select **Create … pots + stake NO** and complete any wallet approvals. Setup can take several transactions.
4. Once all pots show **Staked**, use **Copy group link**. Each friend opens their pot and selects **Join YES**.

You, the organizer, stake **NO** in each pot during setup. Every pot gets its own verdict and payout. A friend's address identifies the intended participant; it does not make the pot private or reserve a place. Until someone joins YES, the pot is unopposed and follows the rules above.

If setup is interrupted, return with the same wallet in the same browser and use **Resume setup**. Saved progress checks completed steps before continuing. Discarding a draft does not undo pots or stakes already created; finish your NO stakes before inviting friends.

## Find your pots and resolve problems

Use **Mine** to find pots you created, joined, or judge, along with group pots intended for you. **Active** includes unsettled pots even after their deadline. Open **Participants** to see who joined each side. Pots and balances refresh automatically about every eight seconds; **Refresh** checks them immediately.

| What you see                                       | What to do                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Not enough SOL                                     | Keep enough for the stake plus fees, and rent if creating a pot. Use **+ Test SOL** if available.                                            |
| Funding failed or timed out                        | Refresh your balance first; the transfer may still arrive. If it stays low, retry later or ask your host for test SOL.                       |
| Join unavailable                                   | Check whether you already joined, the pot has 10 participants, the deadline passed, or it is settled.                                        |
| No verdict controls                                | Connect the named judge's wallet. Verdicts are available only during the five-minute window after the deadline.                              |
| A transaction timed out or has an uncertain result | Open its transaction link and refresh the pot and balance before retrying; it may already have succeeded. For a group, use **Resume setup**. |
| Program unavailable or pots fail to load           | Select **Refresh**. If the error persists, ask your host to check the app's connection.                                                      |

## Open the app on your own computer

With Node.js 22 or newer and npm installed, run these commands from this project folder:

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and follow the steps above. The default configuration connects to devnet; test SOL funding depends on faucet availability. Keep the terminal running while using the app, and press **Ctrl+C** to stop it.

Links shared from localhost work only on your computer. To invite someone on another device, use the app link provided by your host.
