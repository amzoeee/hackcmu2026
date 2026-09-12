/** Mirrors MAX_PARTICIPANTS in the Anchor program and the frontend. */
export const MAX_PARTICIPANTS = 10;
/**
 * The program compares against the cluster Clock, which can trail wall time by
 * a few slots. The frontend keeps joins open this long past the deadline, so
 * the bot reports a pot as closed on the same schedule.
 */
export const CLOCK_DRIFT_SECONDS = 10;
/** Mirrors SETTLEMENT_GRACE_SECONDS: the judge's window after the deadline. */
export const SETTLEMENT_GRACE_SECONDS = 300;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** A pot account in plain values, decoded from the program's IDL. */
export type Pot = {
  address: string;
  creator: string;
  judge: string;
  identifier: bigint;
  task: string;
  /** Fixed stake per participant, in lamports. */
  stake: bigint;
  /** Unix seconds. */
  deadline: number;
  /** Unix seconds. */
  createdAt: number;
  yesParticipants: string[];
  noParticipants: string[];
  settled: boolean;
  outcome: boolean | null;
};

export type PotFilter = "active" | "settled" | "all";

export type PotStatus =
  | { kind: "active"; full: boolean }
  | { kind: "closed" }
  /** Unsettled past the judge's window, so anyone can refund every stake. */
  | { kind: "refundable" }
  /** A null outcome is a timeout refund: settled without a verdict. */
  | { kind: "settled"; outcome: boolean | null };

export type Payout =
  | { kind: "empty"; pool: bigint }
  | {
      kind: "winners";
      side: "YES" | "NO";
      pool: bigint;
      winners: number;
      perWinner: bigint;
    }
  | {
      kind: "refund";
      reason: "unopposed" | "timeout";
      pool: bigint;
      participants: number;
      perParticipant: bigint;
    }
  | { kind: "forfeit"; pool: bigint; judge: string };

export function participantCount(pot: Pot) {
  return pot.yesParticipants.length + pot.noParticipants.length;
}

export function potStatus(pot: Pot, nowSeconds: number): PotStatus {
  if (pot.settled) return { kind: "settled", outcome: pot.outcome };
  if (
    pot.deadline + SETTLEMENT_GRACE_SECONDS + CLOCK_DRIFT_SECONDS <=
    nowSeconds
  )
    return { kind: "refundable" };
  if (pot.deadline + CLOCK_DRIFT_SECONDS <= nowSeconds)
    return { kind: "closed" };
  return { kind: "active", full: participantCount(pot) >= MAX_PARTICIPANTS };
}

/** The frontend's "active" filter is every unsettled pot, including ones awaiting the judge. */
export function filterPots(pots: Pot[], filter: PotFilter) {
  if (filter === "active") return pots.filter((pot) => !pot.settled);
  if (filter === "settled") return pots.filter((pot) => pot.settled);
  return pots;
}

function compareNewestFirst(left: Pot, right: Pot) {
  if (right.createdAt !== left.createdAt)
    return right.createdAt - left.createdAt;
  return right.identifier > left.identifier
    ? 1
    : right.identifier < left.identifier
      ? -1
      : 0;
}

export function sortNewestFirst(pots: Pot[]) {
  return [...pots].sort(compareNewestFirst);
}

export function sortOldestFirst(pots: Pot[]) {
  return sortNewestFirst(pots).reverse();
}

/**
 * Payout exactly as the program settles and the frontend displays it: the pool
 * is the fixed stake times every participant, split equally across the chosen
 * side, refunded to everyone when that side is empty, and nothing for an empty
 * pot. Division dust stays in the pot.
 */
/** Mirrors settle_pot and refund_pot. A null outcome is the timeout refund. */
export function computePayout(
  pot: Pick<Pot, "stake" | "judge" | "yesParticipants" | "noParticipants">,
  outcome: boolean | null,
): Payout {
  const participants = pot.yesParticipants.length + pot.noParticipants.length;
  const pool = pot.stake * BigInt(participants);
  if (participants === 0) return { kind: "empty", pool };
  // Exact original stakes are returned; extra SOL and dust stay in the pot.
  if (outcome === null)
    return {
      kind: "refund",
      reason: "timeout",
      pool,
      participants,
      perParticipant: pot.stake,
    };
  const unopposed =
    pot.yesParticipants.length === 0 || pot.noParticipants.length === 0;
  if (unopposed) {
    return outcome
      ? {
          kind: "refund",
          reason: "unopposed",
          pool,
          participants,
          perParticipant: pot.stake,
        }
      : { kind: "forfeit", pool, judge: pot.judge };
  }
  const side = outcome ? "YES" : "NO";
  const winners = outcome ? pot.yesParticipants : pot.noParticipants;
  return {
    kind: "winners",
    side,
    pool,
    winners: winners.length,
    perWinner: pool / BigInt(winners.length),
  };
}

/** Lamports as a SOL string with up to nine decimals and no trailing zeros. */
export function formatSol(lamports: bigint) {
  const negative = lamports < 0n;
  const magnitude = negative ? -lamports : lamports;
  const whole = magnitude / LAMPORTS_PER_SOL;
  const fraction = (magnitude % LAMPORTS_PER_SOL)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** The same link the app's Share button copies: the page URL with a `pot-<address>` hash. */
export function potLink(appUrl: string, address: string) {
  const url = new URL(appUrl);
  url.search = "";
  url.hash = `pot-${address}`;
  return url.toString();
}
