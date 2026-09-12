import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { createRequire } from "node:module";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  DEFAULT_SOLANA_NETWORK,
  DEFAULT_SOLANA_RPC_URL,
  DEVNET_GENESIS,
} from "../src/lib/networks.mjs";
import { isSecretKeyBytes } from "../src/lib/secret-key.mjs";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const network =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK || DEFAULT_SOLANA_NETWORK;
const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL;
const programId =
  require("../src/lib/anchor/generated/accountability.json").address;
const funderPath = process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
let ready = true;

function sol(lamports) {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, "")} SOL`;
}

async function readAddress(filename) {
  const secret = JSON.parse(await readFile(filename, "utf8"));
  if (!isSecretKeyBytes(secret)) {
    throw new Error("Invalid keypair file");
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey;
}

console.log(`Network: ${network}`);
console.log(`Program: ${programId}`);
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (
      address.family === "IPv4" &&
      !address.internal &&
      address.netmask !== "255.255.255.255"
    ) {
      console.log(`LAN URL (${name}): http://${address.address}:3000`);
    }
  }
}

try {
  // Custom RPC URLs can contain credentials, so only print their origin.
  console.log(`RPC host: ${new URL(rpcUrl).origin}`);
  if (network !== "devnet") {
    throw new Error("This presentation check requires the devnet network.");
  }

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }),
  });
  let genesis;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    throw new Error(
      "The RPC could not be reached. Check the connection and RPC settings.",
    );
  }
  if (genesis !== DEVNET_GENESIS) {
    throw new Error("The configured RPC is not Solana devnet.");
  }
  console.log("Network check: verified devnet");

  let deployer;
  try {
    deployer = await readAddress(".wallets/deployer.json");
  } catch {
    throw new Error(
      "Missing or invalid .wallets/deployer.json. Run npm run tools:setup.",
    );
  }
  console.log(`Deployer: ${deployer.toBase58()}`);

  const [deployerBalance, program] = await Promise.all([
    connection.getBalance(deployer),
    connection.getAccountInfo(new PublicKey(programId)),
  ]);
  console.log(`Deployer balance: ${sol(deployerBalance)}`);
  if (program?.executable) {
    console.log("Program deployed: yes");
  } else {
    console.log("Program deployed: no");
    console.log("Fund the deployer, then run npm run anchor:deploy:devnet.");
    console.log(
      "The optimized program currently needs roughly 0.9 SOL to deploy.",
    );
    ready = false;
  }

  if (funderPath) {
    let funder;
    try {
      funder = await readAddress(funderPath);
    } catch {
      throw new Error(
        "SOLARA_DEMO_FUNDER_KEYPAIR does not point to a valid keypair file.",
      );
    }
    const balance = funder.equals(deployer)
      ? deployerBalance
      : await connection.getBalance(funder);
    console.log(`Demo funder: ${funder.toBase58()}`);
    console.log(`Demo funder balance: ${sol(balance)}`);
    if (balance < 600_000_000) {
      console.log(
        "Demo funder reserve: low; keep at least 0.6 SOL for two guests.",
      );
      ready = false;
    } else {
      console.log("Demo funder reserve: ready for two guests");
    }
  } else {
    console.log(
      "Demo funding: public faucet; availability cannot be guaranteed.",
    );
    console.log(
      "For a reliable presentation, set SOLARA_DEMO_FUNDER_KEYPAIR to a funded devnet keypair.",
    );
    ready = false;
  }
  if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    console.log(
      "Wallet mode: Privy; fund both participant wallets before presenting.",
    );
  } else {
    console.log("Wallet mode: browser demo wallets");
  }
} catch (error) {
  // RPC error messages may contain a private provider URL. Keep unknown failures generic.
  const message = error instanceof Error ? error.message : "";
  const safeMessages = [
    "This presentation check requires the devnet network.",
    "The configured RPC is not Solana devnet.",
    "The RPC could not be reached. Check the connection and RPC settings.",
    "Missing or invalid .wallets/deployer.json. Run npm run tools:setup.",
    "SOLARA_DEMO_FUNDER_KEYPAIR does not point to a valid keypair file.",
  ];
  console.log(
    `Check failed: ${safeMessages.includes(message) ? message : "Could not complete the devnet checks. Verify your RPC and configuration."}`,
  );
  ready = false;
}

console.log(`Demo ready: ${ready ? "yes" : "no"}`);
process.exitCode = ready ? 0 : 1;
