import { Keypair } from "@solana/web3.js";
import type { Pot } from "../src/pots";

export const NOW_SECONDS = 1_800_000_000;
export const APP_URL = "http://localhost:3000";
export const context = { appUrl: APP_URL, nowSeconds: NOW_SECONDS };
export const SOL = 1_000_000_000n;

/** Deterministic, valid base58 addresses. */
export function wallet(index: number) {
  return Keypair.fromSeed(new Uint8Array(32).fill(index)).publicKey.toBase58();
}

let created = 0;

export function makePot(overrides: Partial<Pot> = {}): Pot {
  const index = created++;
  return {
    address: wallet(64 + index),
    creator: wallet(1),
    judge: wallet(2),
    identifier: BigInt(index),
    task: `Task ${index}`,
    stake: SOL / 100n,
    deadline: NOW_SECONDS + 3600,
    createdAt: NOW_SECONDS - 600 + index,
    yesParticipants: [],
    noParticipants: [],
    settled: false,
    outcome: null,
    ...overrides,
  };
}

export const fixtures = {
  active: () =>
    makePot({
      task: "Ship the Discord bot",
      yesParticipants: [wallet(1), wallet(3)],
      noParticipants: [wallet(4)],
    }),
  closed: () =>
    makePot({
      task: "Finish the pitch deck",
      deadline: NOW_SECONDS - 60,
      yesParticipants: [wallet(1)],
      noParticipants: [wallet(4)],
    }),
  settledYes: () =>
    makePot({
      task: "Present Solara's live devnet demo",
      deadline: NOW_SECONDS - 600,
      settled: true,
      outcome: true,
      yesParticipants: [wallet(1), wallet(3)],
      noParticipants: [wallet(4)],
    }),
  /** Unopposed and judged incomplete: the program pays the judge. */
  forfeit: () =>
    makePot({
      task: "Run 5k before Friday",
      deadline: NOW_SECONDS - 600,
      settled: true,
      outcome: false,
      yesParticipants: [wallet(1), wallet(3), wallet(5)],
    }),
  /** Unopposed and judged complete: every stake goes back. */
  unopposedRefund: () =>
    makePot({
      task: "Read one paper a day",
      deadline: NOW_SECONDS - 600,
      settled: true,
      outcome: true,
      yesParticipants: [wallet(1), wallet(3), wallet(5)],
    }),
  /** Settled with no verdict, which only the timeout refund produces. */
  timedOut: () =>
    makePot({
      task: "Rewrite the onboarding copy",
      deadline: NOW_SECONDS - 900,
      settled: true,
      outcome: null,
      yesParticipants: [wallet(1), wallet(3)],
      noParticipants: [wallet(4)],
    }),
  /** Unsettled past the judge's window, so anyone can refund it. */
  refundable: () =>
    makePot({
      task: "Nobody judged this in time",
      deadline: NOW_SECONDS - 400,
      yesParticipants: [wallet(1)],
      noParticipants: [wallet(4)],
    }),
  empty: () =>
    makePot({
      task: "Nobody staked on this",
      deadline: NOW_SECONDS - 600,
      settled: true,
      outcome: true,
    }),
};
