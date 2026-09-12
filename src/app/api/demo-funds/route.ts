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
import { SOLANA_NETWORK, SOLANA_RPC_URL } from "@/lib/solana";

export const runtime = "nodejs";

const FUND_AMOUNT = LAMPORTS_PER_SOL;
const SUFFICIENT_BALANCE = LAMPORTS_PER_SOL / 4;
const cooldowns = new Map<string, number>();
const inFlight = new Set<string>();

async function loadFunder() {
  const filename = process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
  if (!filename) return null;
  const secret = JSON.parse(await readFile(filename, "utf8")) as number[];
  if (!Array.isArray(secret) || secret.length !== 64) {
    throw new Error("The demo funder keypair is not a valid Solana keypair file.");
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function sendDemoSol(connection: Connection, recipient: PublicKey) {
  const funder = await loadFunder();
  if (funder) {
    const funderBalance = await connection.getBalance(funder.publicKey, "confirmed");
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
      { commitment: "confirmed" },
    );
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const signature = await connection.requestAirdrop(recipient, FUND_AMOUNT);
  await connection.confirmTransaction(
    { signature, ...latestBlockhash },
    "confirmed",
  );
  return signature;
}

export async function POST(request: Request) {
  if (SOLANA_NETWORK !== "devnet") {
    return NextResponse.json(
      { error: "Demo funding is available on devnet only." },
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
  if (inFlight.has(address) || (cooldowns.get(address) ?? 0) > now) {
    return NextResponse.json(
      { error: "Funding is already in progress. Check the balance in a moment." },
      { status: 429 },
    );
  }

  inFlight.add(address);
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const currentBalance = await connection.getBalance(recipient, "confirmed");
    if (currentBalance >= SUFFICIENT_BALANCE) {
      return NextResponse.json({
        funded: false,
        message: "This demo wallet already has enough devnet SOL.",
      });
    }

    const signature = await sendDemoSol(connection, recipient);
    cooldowns.set(address, now + 60_000);
    return NextResponse.json({
      funded: true,
      message: "Added 1 devnet SOL to this demo wallet.",
      signature,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown funding error";
    console.error("Demo wallet funding failed:", detail);
    return NextResponse.json(
      {
        error:
          "The devnet faucet is busy. Ask the host to fund the demo wallet or configure a demo funder.",
      },
      { status: 503 },
    );
  } finally {
    inFlight.delete(address);
  }
}
