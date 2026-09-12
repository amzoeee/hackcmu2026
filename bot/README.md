# Solara Discord bot (read-only)

An optional Discord bot for the accountability staking prototype. It answers `/pots` and `/pot <address>` with the current on-chain state and announces new and settled pots in one channel. It only reads: it holds no Solana keys, never signs, and never sends transactions.

The bot is its own npm package. It reads the program IDL from `../src/lib/anchor/generated/accountability.json` at start, so the program address and account layout always match the checked-in client; nothing is copied.

## Requirements

- Node.js 24 (`nvm use 24` in this repository)
- `cd bot && npm ci`

## Try it without a Discord token

```sh
npm run dry-run
```

This reads the pots from Solana devnet, prints a preview of the `/pots` and `/pot` replies, seeds the set of known pots silently, and then prints every message it would post to the channel as pots appear or settle. Press **Ctrl+C** to stop. Set `POLL_INTERVAL_MS=5000` for the fastest allowed polling while demonstrating.

## Create the Discord application

1. Open [discord.com/developers/applications](https://discord.com/developers/applications) and choose **New Application**.
2. On **General Information**, copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. Open **Bot**. Choose **Reset Token**, copy the token once, and keep it private. This is `DISCORD_BOT_TOKEN`. Leave all **Privileged Gateway Intents** off; slash commands and channel posts do not need them.
4. Invite the bot with the `bot` and `applications.commands` scopes and the **Send Messages** and **Embed Links** permissions. Either build the link under **OAuth2 → URL Generator**, or open this URL with your application ID:

   ```text
   https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot%20applications.commands&permissions=18432
   ```

   `18432` is Send Messages (2048) plus Embed Links (16384).

5. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click the server and choose **Copy Server ID** for `DISCORD_GUILD_ID`; right-click the announcement channel and choose **Copy Channel ID** for `DISCORD_CHANNEL_ID`. The bot must be able to view and send messages in that channel.

## Configure

```sh
cp .env.example .env
```

| Variable             | Purpose                                                                                | Default                         |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| `DISCORD_BOT_TOKEN`  | Bot token from the Developer Portal. Required for `npm start` and `npm run register`.  |                                 |
| `DISCORD_CLIENT_ID`  | Application ID. Required for `npm run register`.                                       |                                 |
| `DISCORD_GUILD_ID`   | Server where the slash commands are registered. Required for `npm run register`.       |                                 |
| `DISCORD_CHANNEL_ID` | Channel that receives new-pot and settlement announcements. Required for `npm start`.  |                                 |
| `SOLANA_RPC_URL`     | RPC endpoint for all reads.                                                            | `https://api.devnet.solana.com` |
| `APP_URL`            | Where the web app runs. Pot links are `APP_URL` plus `#pot-<address>`, like **Share**. | `http://localhost:3000`         |
| `POLL_INTERVAL_MS`   | How often the bot reads every pot. Minimum 5000.                                       | `30000`                         |
| `DRY_RUN`            | `1` prints messages to stdout instead of connecting to Discord.                        |                                 |

`bot/.env` is ignored by Git. Variables already set in the shell take precedence over the file.

## Register the slash commands

```sh
npm run register
```

This installs `/pots` and `/pot` in the configured server through the Discord REST API. Guild commands appear immediately. Run it again after changing the command definitions in `src/commands.ts`.

## Run

```sh
npm start
```

The bot logs its program ID and RPC host, connects to Discord, and reads the pots once to seed the known set without posting. Afterwards it reads every `POLL_INTERVAL_MS` and posts:

- **New pot** with the task, stake, deadline, judge, and the app link.
- **Settled** with the outcome and either the winner count and per-winner payout, the stakes returned, or the pool forfeited to the judge. A settled pot with no outcome is a timeout refund.

Restarting the bot never re-announces existing pots because the first read after startup only seeds. Announcements that fail to post are retried on the next poll.

- `/pots [filter]` lists pots newest first with the task, stake, deadline as a relative Discord timestamp, YES/NO counts, status (active, closed awaiting judge, closed with a refund available, or settled with its outcome), and the app link. `filter` is `active`, `settled`, or `all`.
- `/pot <address>` shows one pot: participants per side, judge, outcome, and the payout computed like the program. With both sides present the pool splits equally across the winning side. An unopposed pot returns exact stakes when judged complete and forfeits the whole pool to the judge when judged incomplete. A pot settled after the judge's window returns exact stakes with no verdict, and an empty pot pays nothing. It accepts the address or the link from the app's **Share** button.

## How it reads the chain

Every read is one `getProgramAccounts` call filtered by the Pot account discriminator and decoded with Anchor's coder for the checked-in IDL. Requests time out after 15 seconds and are not retried on rate limits, matching the web app. Accounts that fail to decode are logged and skipped rather than failing the read; a failed read is logged and retried on the next poll. Slash commands reuse a read that is less than ten seconds old, and overlapping reads share one request, so a busy channel does not multiply RPC traffic. Pot text comes from the chain, so it is escaped and mentions are suppressed in every message.

## Verify

```sh
npm run typecheck   # strict TypeScript, no ESLint needed here
npm test            # node --test with fixture pots; no network
npm run check       # both
```

The tests cover message formatting for active, closed, refundable, settled, unopposed forfeiture, unopposed and timeout refund, and empty pots; the payout math including division dust; the seen-set logic that seeds silently and then announces only new and newly settled pots; poll recovery after failed reads and failed posts; the command handlers; the read cache; and configuration parsing. The repository's root `prettier` configuration formats this directory.
