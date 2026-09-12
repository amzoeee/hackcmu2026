# Accountability staking app

A devnet app for staking test SOL on whether someone completes a task.

**What works now:** create a pot, join YES or NO, and have the named judge settle it after the deadline. Payouts, refunds when the winning side is empty, and rent preservation are enforced on-chain. Pot state and balances refresh automatically across multiple browsers.

Without any account configuration, each browser profile gets its own persistent, devnet-only demo wallet and can request test SOL in the page. The app also supports passwordless email/Google onboarding through optional Privy configuration, and users can connect an existing Solana wallet.

## 1. Install these first

- **Node.js 24 LTS**, which includes **npm**. Download it from [nodejs.org](https://nodejs.org/). Node 22 or newer is supported; this scaffold was tested with Node 26.
- **On a Mac: Xcode Command Line Tools.** Open Terminal and run `xcode-select --install`. If it says they are already installed, you are ready.
- **Optional Privy onboarding:** create a Privy app and enable email and Google login. Add its public app ID to `.env.local` as `NEXT_PUBLIC_PRIVY_APP_ID`. A wallet is then created automatically after login. Add every LAN origin you plan to use to the Privy app's allowed origins.
- **For the fallback wallet connection:** install [Phantom](https://phantom.com/) or [Solflare](https://solflare.com/) and switch it to **Solana devnet**.

You do **not** need to install Rust, Solana, or Anchor manually. The setup command below installs them for this project.

You do **not** need a database, Docker, a separate backend, or real SOL.

## 2. Set up the project

Open a terminal **inside this project folder**.

For a new checkout or another computer, run these commands in order:

```sh
npm ci
npm run tools:setup
npm run anchor:build
```

What they do:

| Command                | What it does                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`               | Installs the JavaScript dependencies from the lockfile: Next.js, React, TypeScript, wallet adapters, the Anchor client, and development tools.    |
| `npm run tools:setup`  | Installs Rust, rustfmt, Clippy, Solana CLI 2.3.0, and Anchor 0.32.1 into the ignored `.tools/` folder. Creates local development keys if missing. |
| `npm run anchor:build` | Builds the Rust program and generates the TypeScript client files. Downloads the compatible Solana compiler tools on the first run.               |

**This setup has already been completed on this computer. You can go straight to step 3.** First-time setup on another computer needs internet access and can take several minutes. The installer supports macOS and x86_64 Linux; Linux also needs native compiler/linker tools installed.

To check that the tools are available:

```sh
npm run tools:check
```

## 3. Run the app

```sh
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser. Leave the terminal running. Press **Ctrl+C** in that terminal to stop the server.

Without `NEXT_PUBLIC_PRIVY_APP_ID`, click **Start demo**. Solara creates a devnet-only key in that browser and asks the devnet faucet for 0.25 SOL. The key persists in local storage, so separate browser profiles and LAN devices behave as separate users. No extension, account, or seed phrase is required. **Use wallet extension** remains available as a secondary path.

If the public faucet is rate-limited, fund `.wallets/deployer.json` and set `SOLARA_DEMO_FUNDER_KEYPAIR=.wallets/deployer.json` in `.env.local`. The server will transfer 0.25 devnet SOL to low-balance demo wallets. This route is hard-gated to devnet, and the private key stays on the host. Never configure it with a mainnet keypair.

No environment file is required. The app uses the public devnet RPC by default. If you later need a different devnet RPC, copy `.env.example` to `.env.local`, change `NEXT_PUBLIC_SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_WS_URL`, and restart the server. A keypair path is safe to put there because `.env.local` is ignored; never put the private-key contents in a `NEXT_PUBLIC_` variable.

## Run with multiple people on the LAN

Check the host before inviting participants:

```sh
npm run demo:check
```

The check confirms the configured program is deployed, prints the deployer balance, warns if the guest-funding reserve is low, and prints the LAN URL when it can detect one.

Start a development server that listens on every network interface:

```sh
npm run dev:lan
```

Find the host computer's LAN address, then have each participant open `http://HOST_IP:3000`. For example, a host at `192.168.1.24` shares `http://192.168.1.24:3000`. Allow inbound TCP port 3000 in the host firewall if prompted.

For a steadier production-mode presentation:

```sh
npm run build
npm run start:lan
```

Use a separate browser profile or device for each participant. Wallets are scoped to browser storage; two ordinary tabs in one profile intentionally use the same demo wallet.

## 4. Run the checks and tests

Run these from the project folder. If the dev server is running, use a second terminal.

```sh
# Check frontend code, TypeScript, and the production build:
npm run check

# Build the Anchor program and test it on a local Solana validator:
npm test
```

**`npm test` starts and stops its own local validator.** It tests pot creation, duplicate, late, and full-pot joins, unauthorized and early settlement, recipient validation, YES and NO winning payouts, one-sided refunds, repeated settlement, empty pots, and rent/dust preservation.

Other useful commands:

```sh
npm run anchor:build   # Rebuild after changing Rust code; updates client types too
npm run format        # Format JavaScript, TypeScript, CSS, and Markdown
npm run format:check  # Check formatting without changing files

# Format Rust code:
bash scripts/with-tools.sh cargo fmt --all
```

The frontend uses **devnet**. Automated program tests use **localnet**, a temporary blockchain running on your computer.

## 5. Which files should I edit?

| What you want to change                           | File                                   |
| ------------------------------------------------- | -------------------------------------- |
| Main page selection                               | `src/app/page.tsx`                     |
| Create-pot form, pot list, and transaction UI     | `src/components/solara-app.tsx`        |
| Embedded and browser wallet paths                 | `src/components/wallet-experience.tsx` |
| Colors, spacing, and layout styles                | `src/app/globals.css`                  |
| App-wide layout and page title                    | `src/app/layout.tsx`                   |
| Wallet connection setup                           | `src/components/wallet-provider.tsx`   |
| Anchor client used to call the program            | `src/lib/anchor/client.ts`             |
| Default Solana RPC endpoint                       | `src/lib/solana.ts`                    |
| On-chain logic: add create, join, and settle here | `programs/accountability/src/lib.rs`   |
| Rust dependencies                                 | `programs/accountability/Cargo.toml`   |
| Program tests                                     | `tests/accountability.test.ts`         |
| Anchor network, wallet, and program addresses     | `Anchor.toml`                          |
| JavaScript dependencies and npm commands          | `package.json`                         |
| Requirements for the finished prototype           | `AGENTS.md`                            |

**Do not edit `src/lib/anchor/generated/` by hand.** Run `npm run anchor:build` after changing the Rust program to regenerate these files. Keep the generated files in Git so the frontend can build without a Rust setup.

**Do not commit `.wallets/`, `.tools/`, or `target/`.** They are already ignored. `.wallets/deployer.json` is the local development wallet; `target/deploy/accountability-keypair.json` determines the program address. Keep that program keypair if you want to keep the same address. A fresh setup generates a new one and synchronizes the configuration.

## Devnet deployment

1. Fund the address printed by `npm run demo:check` with at least 1.15 devnet SOL for the current program build. Keep another 0.6 SOL if the host will fund two guest wallets.
2. Run `npm run anchor:deploy:devnet`.
3. Run `npm run demo:check` again and require `Demo ready: yes`.
4. Put the same deployed program address in `Anchor.toml` and regenerate the IDL with `npm run anchor:build` if it changes.
5. Add `NEXT_PUBLIC_PRIVY_APP_ID` to `.env.local`, or use the built-in demo wallets.
6. Create a short-deadline pot, have two wallets take opposite sides, and settle from the judge wallet after the deadline.

## Known setup notes

- The installed macOS Solana tools can print an “undefined and not known syscalls” build warning because their syscall-name list is empty. The scaffold's local transaction test passes despite that warning.
- `npm audit` still reports upstream advisories in the Anchor/web3.js dependency chain (`toml`, `stream-json`, and `uuid`). Compatible fixes were applied; npm currently provides no compatible fix for the remaining advisories.
