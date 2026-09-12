import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { silentLogger } from "../src/logger";
import type { Pot } from "../src/pots";
import {
  createSeenState,
  pollOnce,
  startPolling,
  trackPots,
  type Announcement,
} from "../src/watcher";
import { fixtures, makePot } from "./fixtures";

const kinds = (announcements: Announcement[]) =>
  announcements.map(({ kind, pot }) => `${kind}:${pot.task}`);

describe("trackPots", () => {
  it("seeds silently on the first poll so restarts do not re-announce", () => {
    const state = createSeenState();
    const pots = [fixtures.active(), fixtures.settledYes()];
    assert.deepEqual(trackPots(state, pots), []);
    assert.equal(state.seeded, true);
    assert.deepEqual(trackPots(state, pots), []);
  });

  it("announces only new and newly settled pots afterwards, oldest first", () => {
    const state = createSeenState();
    const existing = makePot({ task: "Existing", createdAt: 100 });
    const willSettle = makePot({ task: "Will settle", createdAt: 200 });
    trackPots(state, [willSettle, existing]);

    const created = makePot({ task: "Created later", createdAt: 300 });
    const settledNow: Pot = { ...willSettle, settled: true, outcome: true };
    const announcements = trackPots(state, [created, settledNow, existing]);
    assert.deepEqual(kinds(announcements), [
      "settled:Will settle",
      "new:Created later",
    ]);
    assert.deepEqual(trackPots(state, [created, settledNow, existing]), []);
  });

  it("announces a pot that first appears already settled as new and settled", () => {
    const state = createSeenState();
    trackPots(state, []);
    const pot = fixtures.settledYes();
    assert.deepEqual(kinds(trackPots(state, [pot])), [
      `new:${pot.task}`,
      `settled:${pot.task}`,
    ]);
  });
});

describe("pollOnce", () => {
  it("survives a failed read and seeds on the next successful one", async () => {
    const state = createSeenState();
    const posted: string[] = [];
    let attempt = 0;
    const pots = [fixtures.active()];
    const deps = {
      state,
      log: silentLogger,
      announce: async ({ kind, pot }: Announcement) => {
        posted.push(`${kind}:${pot.task}`);
      },
      readPots: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("fetch failed");
        return pots;
      },
    };

    const failed = await pollOnce(deps);
    assert.equal(failed.ok, false);
    assert.equal(state.seeded, false);

    const seeded = await pollOnce(deps);
    assert.equal(seeded.ok && seeded.seeded, true);
    assert.deepEqual(posted, []);

    pots.push(makePot({ task: "Brand new", createdAt: 9_999_999_999 }));
    const announced = await pollOnce(deps);
    assert.equal(announced.ok && announced.announcements.length, 1);
    assert.deepEqual(posted, ["new:Brand new"]);
  });

  it("re-announces on the next poll when posting fails", async () => {
    const state = createSeenState();
    const pot = makePot({ task: "Flaky post" });
    let failPosts = true;
    const posted: string[] = [];
    const deps = {
      state,
      log: silentLogger,
      readPots: async () => [pot],
      announce: async ({ kind }: Announcement) => {
        if (failPosts) throw new Error("Discord unavailable");
        posted.push(kind);
      },
    };
    trackPots(state, []);
    await pollOnce(deps);
    assert.deepEqual(posted, []);
    failPosts = false;
    await pollOnce(deps);
    assert.deepEqual(posted, ["new"]);
    await pollOnce(deps);
    assert.deepEqual(posted, ["new"]);
  });
});

describe("startPolling", () => {
  it("polls on the interval until stopped", async () => {
    let reads = 0;
    const stop = startPolling(
      {
        state: createSeenState(),
        log: silentLogger,
        announce: async () => {},
        readPots: async () => {
          reads += 1;
          return [];
        },
      },
      10,
    );
    while (reads < 3) await delay(5);
    stop();
    const readsAtStop = reads;
    await delay(40);
    assert.equal(reads, readsAtStop);
  });
});
