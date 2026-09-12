import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  DEMO_WALLETS_ENABLED,
  DEVNET_GENESIS,
  IS_LOCALNET,
  SOLANA_NETWORK,
  SOLANA_RPC_URL,
  SOLANA_WS_URL,
} from "@/lib/solana";

export const runtime = "nodejs";

const FUND_AMOUNT = LAMPORTS_PER_SOL / 4;
const SUFFICIENT_BALANCE = LAMPORTS_PER_SOL / 20;
const cooldowns = new Map<string, number>();
const inFlight = new Set<string>();

async function loadFunder() {
  const filename = process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
  if (!filename) return null;
  const secret = JSON.parse(await readFile(filename, "utf8")) as number[];
  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    secret.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error(
      "The demo funder keypair is not a valid Solana keypair file.",
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function sendDemoSol(
  connection: Connection,
  recipient: PublicKey,
  abortSignal: AbortSignal,
) {
  const funder = IS_LOCALNET ? null : await loadFunder();
  if (funder) {
    const funderBalance = await connection.getBalance(
      funder.publicKey,
      "confirmed",
    );
    if (funderBalance < FUND_AMOUNT + 10_000) {
      throw new Error("The host's demo funder needs more devnet SOL.");
    }
    return sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: recipient,
          lamports: FUND_AMOUNT,
        }),
      ),
      [funder],
      { commitment: "confirmed", abortSignal },
    );
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const signature = await connection.requestAirdrop(recipient, FUND_AMOUNT);
  const confirmation = await connection.confirmTransaction(
    { signature, ...latestBlockhash, abortSignal },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error("The test SOL faucet transfer did not succeed.");
  }
  return signature;
}

export async function POST(request: Request) {
  if (!DEMO_WALLETS_ENABLED) {
    return NextResponse.json(
      {
        error:
          "Demo funding requires devnet or an explicit localnet with a loopback RPC.",
      },
      { status: 403 },
    );
  }

  let recipient: PublicKey;
  try {
    const body = (await request.json()) as { address?: unknown };
    if (typeof body.address !== "string") throw new Error("Missing address");
    recipient = new PublicKey(body.address);
  } catch {
    return NextResponse.json(
      { error: "Provide a valid Solana wallet address." },
      { status: 400 },
    );
  }

  const address = recipient.toBase58();
  const now = Date.now();
  for (const [fundedAddress, expiresAt] of cooldowns) {
    if (expiresAt <= now) cooldowns.delete(fundedAddress);
  }
  const retryAfter = Math.max(
    1,
    Math.ceil(((cooldowns.get(address) ?? now + 10_000) - now) / 1000),
  );
  if (inFlight.has(address) || cooldowns.has(address)) {
    return NextResponse.json(
      {
        error: inFlight.has(address)
          ? "Funding is already in progress. Check the balance in a moment."
          : `Test SOL was recently requested for this wallet. Check its balance, or try again in ${retryAfter} seconds.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  inFlight.add(address);
  const abortSignal = AbortSignal.timeout(30_000);
  try {
    const connection = new Connection(SOLANA_RPC_URL, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      wsEndpoint: SOLANA_WS_URL,
      fetch: (url, options) => fetch(url, { ...options, signal: abortSignal }),
    });
    if (!IS_LOCALNET) {
      let genesis;
      try {
        genesis = await connection.getGenesisHash();
      } catch {
        if (abortSignal.aborted) throw abortSignal.reason;
        return NextResponse.json(
          {
            error:
              "Could not verify devnet. Check the RPC connection and try again.",
          },
          { status: 503 },
        );
      }
      if (genesis !== DEVNET_GENESIS) {
        return NextResponse.json(
          {
            error:
              "The configured RPC is not Solana devnet. Funding was stopped.",
          },
          { status: 403 },
        );
      }
    }
    const currentBalance = await connection.getBalance(recipient, "confirmed");
    if (currentBalance >= SUFFICIENT_BALANCE) {
      return NextResponse.json({
        funded: false,
        message: `This demo wallet already has enough ${SOLANA_NETWORK} SOL.`,
      });
    }

    const signature = await sendDemoSol(connection, recipient, abortSignal);
    cooldowns.set(address, Date.now() + 60_000);
    return NextResponse.json({
      funded: true,
      message: `Added 0.25 ${SOLANA_NETWORK} SOL to this demo wallet.`,
      signature,
    });
  } catch (error) {
    if (abortSignal.aborted) {
      // A submitted transfer can still land after confirmation times out.
      cooldowns.set(address, Date.now() + 60_000);
      return NextResponse.json(
        {
          error:
            "The funding request timed out. Check your balance before requesting more test SOL in a minute.",
        },
        { status: 504, headers: { "Retry-After": "60" } },
      );
    }
    const detail =
      error instanceof Error ? error.message : "Unknown funding error";
    console.error("Demo wallet funding failed:", detail);
    return NextResponse.json(
      {
        error: IS_LOCALNET
          ? "The local validator could not add test SOL. Check that the local rehearsal is still running, then try again."
          : process.env.SOLARA_DEMO_FUNDER_KEYPAIR
            ? "The host could not add test SOL. Ask the host to check the demo funder's balance and connection, then try again."
            : "The devnet faucet is busy. Try again later, or ask the host to fund this wallet with devnet SOL.",
      },
      { status: 503 },
    );
  } finally {
    inFlight.delete(address);
  }
}
