import type { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const ONE_SOL = BigInt(LAMPORTS_PER_SOL);

// Pot::SPACE in the Anchor program, including the account discriminator.
export const POT_ACCOUNT_BYTES = 599;

const POT_SEED = new TextEncoder().encode("pot");

type Identifier = BN | bigint | number | string;

function identifierSeed(identifier: Identifier) {
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigUint64(
    0,
    typeof identifier === "string" ? BigInt(identifier) : asBigInt(identifier),
    true,
  );
  return seed;
}

/** The single definition of the pot PDA; the program derives it the same way. */
export function potAddress(
  creator: PublicKey,
  identifier: Identifier,
  programId: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [POT_SEED, creator.toBytes(), identifierSeed(identifier)],
    programId,
  )[0];
}

export function asBigInt(value: BN | bigint | number) {
  return typeof value === "bigint"
    ? value
    : typeof value === "number"
      ? BigInt(value)
      : BigInt(value.toString());
}

export function formatSol(lamports: BN | bigint | number) {
  const amount = asBigInt(lamports);
  const whole = amount / ONE_SOL;
  const remainder = amount % ONE_SOL;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 9,
  });
  const fraction = formatter
    .formatToParts(
      Number(remainder < 0n ? -remainder : remainder) / LAMPORTS_PER_SOL,
    )
    .filter(({ type }) => type === "decimal" || type === "fraction")
    .map(({ value }) => value)
    .join("");
  return `${formatter.format(amount < 0n && whole === 0n ? -0 : whole)}${fraction}`;
}

export function parseSol(value: string) {
  if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(value.trim())) {
    throw new Error(
      "Enter a SOL amount using a decimal point and up to 9 decimal places.",
    );
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const lamports =
    BigInt(whole) * ONE_SOL + BigInt((fraction + "000000000").slice(0, 9));
  if (lamports <= 0n) throw new Error("Stake must be greater than zero.");
  if (lamports > 18_446_744_073_709_551_615n) {
    throw new Error("This stake is too large. Enter a smaller SOL amount.");
  }
  return lamports;
}

export function deadlineFromNow(minutes: number) {
  const date = new Date(Date.now() + minutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}
