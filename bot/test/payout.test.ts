import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePayout,
  filterPots,
  formatSol,
  potLink,
  potStatus,
  sortNewestFirst,
} from "../src/pots";
import { fixtures, makePot, NOW_SECONDS, SOL, wallet } from "./fixtures";

describe("computePayout", () => {
  it("splits the pool equally across the winning side", () => {
    const payout = computePayout(fixtures.settledYes(), true);
    assert.deepEqual(payout, {
      kind: "winners",
      side: "YES",
      pool: 3n * (SOL / 100n),
      winners: 2,
      perWinner: 15_000_000n,
    });
  });

  it("pays the NO side when the task was not completed", () => {
    const payout = computePayout(fixtures.settledYes(), false);
    assert.equal(payout.kind, "winners");
    assert.equal(payout.kind === "winners" && payout.side, "NO");
    assert.equal(payout.kind === "winners" && payout.perWinner, 30_000_000n);
  });

  it("forfeits an unopposed incomplete pot to the judge", () => {
    const pot = fixtures.forfeit();
    assert.deepEqual(computePayout(pot, false), {
      kind: "forfeit",
      pool: 3n * pot.stake,
      judge: pot.judge,
    });
  });

  it("returns exact stakes for an unopposed completed pot", () => {
    const pot = fixtures.unopposedRefund();
    assert.deepEqual(computePayout(pot, true), {
      kind: "refund",
      reason: "unopposed",
      pool: 3n * pot.stake,
      participants: 3,
      perParticipant: pot.stake,
    });
  });

  it("returns exact stakes when no verdict was recorded", () => {
    const pot = fixtures.timedOut();
    assert.deepEqual(computePayout(pot, null), {
      kind: "refund",
      reason: "timeout",
      pool: 3n * pot.stake,
      participants: 3,
      perParticipant: pot.stake,
    });
  });

  it("pays nothing for an empty pot", () => {
    assert.deepEqual(computePayout(fixtures.empty(), true), {
      kind: "empty",
      pool: 0n,
    });
  });

  it("leaves division dust in the pot", () => {
    const pot = makePot({
      stake: 3_000_000n,
      yesParticipants: Array.from({ length: 7 }, (_, i) => wallet(10 + i)),
      noParticipants: Array.from({ length: 3 }, (_, i) => wallet(20 + i)),
    });
    const payout = computePayout(pot, true);
    assert.equal(payout.kind, "winners");
    if (payout.kind !== "winners") return;
    assert.equal(payout.pool, 30_000_000n);
    assert.equal(payout.perWinner, 4_285_714n);
    assert.equal(payout.pool - payout.perWinner * 7n, 2n);
  });
});

describe("formatSol", () => {
  it("prints lamports as SOL without trailing zeros", () => {
    assert.equal(formatSol(0n), "0");
    assert.equal(formatSol(SOL), "1");
    assert.equal(formatSol(SOL / 100n), "0.01");
    assert.equal(formatSol(1_500_000_000n), "1.5");
    assert.equal(formatSol(4_285_714n), "0.004285714");
    assert.equal(formatSol(1n), "0.000000001");
  });
});

describe("potStatus", () => {
  it("reports open, full, closed, and settled pots like the app", () => {
    assert.deepEqual(potStatus(fixtures.active(), NOW_SECONDS), {
      kind: "active",
      full: false,
    });
    const full = makePot({
      yesParticipants: Array.from({ length: 10 }, (_, i) => wallet(10 + i)),
    });
    assert.deepEqual(potStatus(full, NOW_SECONDS), {
      kind: "active",
      full: true,
    });
    assert.deepEqual(potStatus(fixtures.closed(), NOW_SECONDS), {
      kind: "closed",
    });
    assert.deepEqual(potStatus(fixtures.settledYes(), NOW_SECONDS), {
      kind: "settled",
      outcome: true,
    });
    assert.deepEqual(potStatus(fixtures.forfeit(), NOW_SECONDS), {
      kind: "settled",
      outcome: false,
    });
    assert.deepEqual(potStatus(fixtures.timedOut(), NOW_SECONDS), {
      kind: "settled",
      outcome: null,
    });
    assert.deepEqual(potStatus(fixtures.refundable(), NOW_SECONDS), {
      kind: "refundable",
    });
  });

  it("holds the judge's window open through the clock-drift allowance", () => {
    const pot = makePot({ deadline: NOW_SECONDS - 305 });
    assert.equal(potStatus(pot, NOW_SECONDS).kind, "closed");
    assert.equal(potStatus(pot, NOW_SECONDS + 5).kind, "refundable");
  });

  it("keeps a pot active through the app's clock-drift allowance", () => {
    const pot = makePot({ deadline: NOW_SECONDS - 5 });
    assert.equal(potStatus(pot, NOW_SECONDS).kind, "active");
    assert.equal(potStatus(pot, NOW_SECONDS + 5).kind, "closed");
  });
});

describe("potLink", () => {
  it("builds the same link as the app's Share button", () => {
    const address = wallet(9);
    assert.equal(
      potLink("http://localhost:3000", address),
      `http://localhost:3000/#pot-${address}`,
    );
    assert.equal(
      potLink("http://192.168.1.20:3000/?from=lan#pot-old", address),
      `http://192.168.1.20:3000/#pot-${address}`,
    );
  });
});

describe("pot ordering and filters", () => {
  it("sorts newest first by creation time, then identifier", () => {
    const older = makePot({ createdAt: 100, identifier: 5n });
    const newerLowId = makePot({ createdAt: 200, identifier: 1n });
    const newerHighId = makePot({ createdAt: 200, identifier: 2n });
    assert.deepEqual(
      sortNewestFirst([older, newerLowId, newerHighId]).map(
        (pot) => pot.address,
      ),
      [newerHighId.address, newerLowId.address, older.address],
    );
  });

  it("treats every unsettled pot as active, including closed ones", () => {
    const pots = [fixtures.active(), fixtures.closed(), fixtures.settledYes()];
    assert.equal(filterPots(pots, "active").length, 2);
    assert.equal(filterPots(pots, "settled").length, 1);
    assert.equal(filterPots(pots, "all").length, 3);
  });
});
