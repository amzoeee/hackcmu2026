import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_SOLANA_RPC_URL,
  DEVNET_GENESIS,
} from "../src/lib/networks.mjs";
import { isSecretKeyBytes } from "../src/lib/secret-key.mjs";

// Solana 2.3's automatic extension can be smaller than SIMD-0431 now permits.
// https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0431-minimum-extend-program-size.md
const MINIMUM_EXTENSION_BYTES = 10_240;
const PROGRAM_DATA_METADATA_BYTES = 45;
const MAX_ACCOUNT_BYTES = 10_485_760;
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const checkOnly = process.argv.includes("--check");

const connection = new Connection(DEFAULT_SOLANA_RPC_URL, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: (url, options) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }),
});
if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) {
  throw new Error("Program extension requires verified Solana devnet.");
}
const idl = JSON.parse(
  await readFile("src/lib/anchor/generated/accountability.json", "utf8"),
);
const programId = new PublicKey(idl.address);
const program = await connection.getAccountInfo(programId);
if (!program) {
  console.log("Program capacity: initial deployment; no extension needed.");
  process.exit(0);
}
if (
  !program.executable ||
  !program.owner.equals(loader) ||
  program.data.length < 36 ||
  program.data.readUInt32LE(0) !== 2
) {
  throw new Error("The existing program is not an upgradeable loader program.");
}
const programDataAddress = new PublicKey(program.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress);
if (
  !programData?.owner.equals(loader) ||
  programData.data.length < PROGRAM_DATA_METADATA_BYTES ||
  programData.data.readUInt32LE(0) !== 3
) {
  throw new Error("The existing ProgramData account is invalid.");
}
const binaryBytes = (await stat("target/deploy/accountability.so")).size;
const capacity = programData.data.length - PROGRAM_DATA_METADATA_BYTES;
if (binaryBytes <= capacity) {
  console.log(
    `Program capacity: ${capacity} bytes; binary fits without extension.`,
  );
  process.exit(0);
}
if (binaryBytes + PROGRAM_DATA_METADATA_BYTES > MAX_ACCOUNT_BYTES) {
  throw new Error("The program binary exceeds Solana's maximum account size.");
}
const secret = JSON.parse(await readFile(".wallets/deployer.json", "utf8"));
if (!isSecretKeyBytes(secret)) throw new Error("Invalid deployer keypair.");
const deployer = Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey;
if (
  programData.data[12] !== 1 ||
  !new PublicKey(programData.data.subarray(13, 45)).equals(deployer)
) {
  throw new Error("The deployer is not this program's upgrade authority.");
}
const additionalBytes = Math.min(
  Math.max(binaryBytes - capacity, MINIMUM_EXTENSION_BYTES),
  MAX_ACCOUNT_BYTES - programData.data.length,
);
console.log(
  `Program capacity: ${capacity} bytes; binary ${binaryBytes} bytes; extension ${additionalBytes} bytes${checkOnly ? " (check only)" : ""}.`,
);
if (!checkOnly) {
  execFileSync(
    "solana",
    [
      "program",
      "extend",
      programId.toBase58(),
      String(additionalBytes),
      "--url",
      "devnet",
      "--keypair",
      ".wallets/deployer.json",
    ],
    { stdio: "inherit" },
  );
}
