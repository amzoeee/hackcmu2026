import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commandDefinitions,
  executeCommand,
  parsePotAddress,
} from "../src/commands";
import type { Pot } from "../src/pots";
import type { PotSource } from "../src/source";
import { APP_URL, fixtures, NOW_SECONDS, wallet } from "./fixtures";

function fakeSource(
  pots: Pot[],
  onRefresh: () => Pot[] = () => pots,
): PotSource & {
  refreshes: number;
} {
  const source = {
    refreshes: 0,
    get: async () => pots,
    refresh: async () => {
      source.refreshes += 1;
      return onRefresh();
    },
    latest: () => pots,
  };
  return source;
}

const options = (values: Record<string, string>) => ({
  getString: (name: string) => values[name] ?? null,
});
const now = () => NOW_SECONDS * 1000;

describe("commandDefinitions", () => {
  it("registers /pots with a filter choice and /pot with a required address", () => {
    assert.deepEqual(
      commandDefinitions.map((command) => command.name),
      ["pots", "pot"],
    );
    const [pots, pot] = commandDefinitions;
    assert.deepEqual(
      pots?.options?.[0] && "choices" in pots.options[0]
        ? pots.options[0].choices?.map((choice) => choice.value)
        : [],
      ["active", "settled", "all"],
    );
    assert.equal(pot?.options?.[0]?.required, true);
  });
});

describe("parsePotAddress", () => {
  it("accepts a bare address or the app's shared link", () => {
    const address = wallet(7);
    assert.equal(parsePotAddress(address), address);
    assert.equal(parsePotAddress(` ${address} `), address);
    assert.equal(parsePotAddress(`${APP_URL}/#pot-${address}`), address);
    assert.equal(parsePotAddress("not an address"), null);
    assert.equal(parsePotAddress(""), null);
  });
});

describe("executeCommand", () => {
  it("lists pots with the requested filter", async () => {
    const pots = [fixtures.active(), fixtures.settledYes()];
    const source = fakeSource(pots);
    const [all] = await executeCommand("pots", options({}), {
      source,
      appUrl: APP_URL,
      now,
    });
    assert.match(all ?? "", /^\*\*2 pots\*\*/);
    const [settled] = await executeCommand(
      "pots",
      options({ filter: "settled" }),
      {
        source,
        appUrl: APP_URL,
        now,
      },
    );
    assert.match(settled ?? "", /^\*\*1 settled pot\*\*/);
    const [bogus] = await executeCommand("pots", options({ filter: "bogus" }), {
      source,
      appUrl: APP_URL,
      now,
    });
    assert.match(bogus ?? "", /^\*\*2 pots\*\*/);
    assert.equal(source.refreshes, 0);
  });

  it("shows a pot from the cache and refreshes once for an unknown address", async () => {
    const known = fixtures.active();
    const arriving = fixtures.closed();
    const source = fakeSource([known], () => [known, arriving]);
    const [details] = await executeCommand(
      "pot",
      options({ address: known.address }),
      {
        source,
        appUrl: APP_URL,
        now,
      },
    );
    assert.match(details ?? "", /Ship the Discord bot/);
    assert.equal(source.refreshes, 0);

    const [fresh] = await executeCommand(
      "pot",
      options({ address: `${APP_URL}/#pot-${arriving.address}` }),
      { source, appUrl: APP_URL, now },
    );
    assert.match(fresh ?? "", /Finish the pitch deck/);
    assert.equal(source.refreshes, 1);

    const missing = wallet(50);
    const [notFound] = await executeCommand(
      "pot",
      options({ address: missing }),
      {
        source,
        appUrl: APP_URL,
        now,
      },
    );
    assert.equal(notFound, `No pot found at \`${missing}\` on this program.`);

    const [invalid] = await executeCommand(
      "pot",
      options({ address: "nope" }),
      {
        source,
        appUrl: APP_URL,
        now,
      },
    );
    assert.match(invalid ?? "", /does not look like a pot address/);
  });
});
