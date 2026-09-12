import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkMessages,
  DISCORD_MESSAGE_LIMIT,
  formatNewPotAnnouncement,
  formatPotDetails,
  formatPotEntry,
  formatPotListView,
  formatPotList,
  formatSettledAnnouncement,
} from "../src/format";
import { shorten } from "../src/pots";
import { APP_URL, context, fixtures, makePot, wallet } from "./fixtures";

describe("formatPotEntry", () => {
  it("shows an active pot with counts, stake, relative deadline, and the app link", () => {
    const pot = fixtures.active();
    const entry = formatPotEntry(pot, context);
    assert.equal(
      entry,
      [
        "**Ship the Discord bot** — Active",
        `0.01 SOL stake · YES 2 · NO 1 · deadline <t:${pot.deadline}:f> (<t:${pot.deadline}:R>)`,
        `<${APP_URL}/#pot-${pot.address}>`,
      ].join("\n"),
    );
  });

  it("marks a pot past its deadline as awaiting the judge", () => {
    assert.match(
      formatPotEntry(fixtures.closed(), context),
      /^\*\*Finish the pitch deck\*\* — Closed · awaiting judge\n/,
    );
  });

  it("shows the outcome of a settled pot", () => {
    assert.match(
      formatPotEntry(fixtures.settledYes(), context),
      /Settled · completed/,
    );
    assert.match(
      formatPotEntry(fixtures.refund(), context),
      /Settled · not completed/,
    );
  });

  it("escapes markdown in on-chain task text", () => {
    const pot = makePot({ task: "*not bold* `code` @everyone" });
    const entry = formatPotEntry(pot, context);
    assert.match(entry, /\\\*not bold\\\*/);
    assert.doesNotMatch(entry, /\*\*\*not bold\*/);
  });
});

describe("formatPotDetails", () => {
  it("lists participants per side, the judge, and the settled payout", () => {
    const pot = fixtures.settledYes();
    const details = formatPotDetails(pot, context);
    assert.match(details, /^\*\*Present Solara's live devnet demo\*\*\n/);
    assert.match(details, /Status: Settled · completed/);
    assert.match(
      details,
      /Stake: 0\.01 SOL · Staked pool: 0\.03 SOL · 3\/10 places filled/,
    );
    assert.match(details, new RegExp(`Judge: \`${shorten(wallet(2))}\``));
    assert.match(
      details,
      new RegExp(
        `YES \\(2\\): \`${shorten(wallet(1))}\`, \`${shorten(wallet(3))}\``,
      ),
    );
    assert.match(details, new RegExp(`NO \\(1\\): \`${shorten(wallet(4))}\``));
    assert.match(
      details,
      /Payout: The 0\.03 SOL pool was paid to 2 YES participants: 0\.015 SOL each, including their stake\./,
    );
    assert.match(details, new RegExp(`Address: \`${pot.address}\``));
    assert.ok(details.endsWith(`\n${APP_URL}/#pot-${pot.address}`));
  });

  it("describes a one-sided refund", () => {
    const details = formatPotDetails(fixtures.refund(), context);
    assert.match(details, /Status: Settled · not completed/);
    assert.match(details, /NO \(0\): —/);
    assert.match(
      details,
      /Payout: No one chose NO, so all 3 participants were refunded 0\.01 SOL each\./,
    );
  });

  it("describes an empty settled pot", () => {
    assert.match(
      formatPotDetails(fixtures.empty(), context),
      /Payout: Empty pot settled\. No SOL to distribute\./,
    );
  });

  it("projects both outcomes for an unsettled pot", () => {
    const details = formatPotDetails(fixtures.active(), context);
    assert.match(
      details,
      /If YES wins: 2 YES participants would receive 0\.015 SOL each from the 0\.03 SOL pool/,
    );
    assert.match(
      details,
      /If NO wins: 1 NO participant would receive 0\.03 SOL each from the 0\.03 SOL pool/,
    );
    const closed = formatPotDetails(fixtures.closed(), context);
    assert.match(closed, /Status: Closed · awaiting judge/);
  });
});

describe("announcements", () => {
  it("announces a new pot with its stake, deadline, judge, and link", () => {
    const pot = makePot({ task: "Write the README" });
    assert.equal(
      formatNewPotAnnouncement(pot, context),
      [
        "New pot: **Write the README**",
        `0.01 SOL stake · deadline <t:${pot.deadline}:f> (<t:${pot.deadline}:R>) · judge \`${shorten(wallet(2))}\` · YES 0 · NO 0`,
        `${APP_URL}/#pot-${pot.address}`,
      ].join("\n"),
    );
  });

  it("announces a settled pot with the winner count and per-winner payout", () => {
    const pot = fixtures.settledYes();
    assert.equal(
      formatSettledAnnouncement(pot, context),
      [
        "Settled: **Present Solara's live devnet demo** — Completed (YES wins)",
        "The 0.03 SOL pool was paid to 2 YES participants: 0.015 SOL each, including their stake.",
        `${APP_URL}/#pot-${pot.address}`,
      ].join("\n"),
    );
  });

  it("announces a one-sided refund and an empty settlement", () => {
    assert.match(
      formatSettledAnnouncement(fixtures.refund(), context),
      /— Not completed \(NO wins\)\nNo one chose NO, so all 3 participants were refunded 0\.01 SOL each\./,
    );
    assert.match(
      formatSettledAnnouncement(fixtures.empty(), context),
      /— Completed \(YES wins\)\nEmpty pot settled\. No SOL to distribute\./,
    );
  });
});

describe("formatPotList", () => {
  it("explains an empty result for each filter", () => {
    assert.deepEqual(formatPotList([], "active", context), [
      "No active pots right now.",
    ]);
    assert.deepEqual(formatPotList([], "settled", context), [
      "No settled pots yet.",
    ]);
    assert.deepEqual(formatPotList([], "all", context), [
      `No pots yet. Create one in the app: ${APP_URL}`,
    ]);
  });

  describe("formatPotListView", () => {
    it("renders one pot with navigation controls", () => {
      const pots = [fixtures.active(), fixtures.settledYes()];
      const view = formatPotListView(pots, "all", context, 0);
      assert.ok(view);
      assert.equal(view.embed.data.title, "Present Solara's live devnet demo");
      assert.equal(view.embed.data.fields?.find((field) => field.name === "Participants")?.value.includes("YES 2"), true);
      const buttons = view.components[0]?.components.map((button) =>
        "custom_id" in button.data ? button.data.custom_id : undefined,
      );
      assert.deepEqual(buttons, ["pots:all:0", "pots:all:1"]);
    });

    it("returns no view for an empty filter", () => {
      assert.equal(formatPotListView([], "settled", context, 0), null);
    });
  });

  it("applies the filter and counts the visible pots", () => {
    const pots = [fixtures.active(), fixtures.closed(), fixtures.settledYes()];
    const [all] = formatPotList(pots, "all", context);
    assert.match(all ?? "", /^\*\*3 pots\*\*, newest first\n\n/);
    const [active] = formatPotList(pots, "active", context);
    assert.match(active ?? "", /^\*\*2 active pots\*\*/);
    assert.doesNotMatch(active ?? "", /Present Solara/);
    const [settled] = formatPotList(pots, "settled", context);
    assert.match(settled ?? "", /^\*\*1 settled pot\*\*/);
  });

  it("splits long lists across messages under Discord's limit", () => {
    const pots = Array.from({ length: 40 }, () => fixtures.active());
    const messages = formatPotList(pots, "all", context);
    assert.ok(messages.length > 1);
    for (const message of messages) {
      assert.ok(message.length <= DISCORD_MESSAGE_LIMIT);
    }
    const joined = messages.join("\n");
    for (const pot of pots) assert.ok(joined.includes(pot.address));
  });

  it("truncates a single entry that exceeds the limit", () => {
    const [message] = chunkMessages(["x".repeat(2500)], "\n\n", 100);
    assert.equal(message?.length, 100);
    assert.ok(message?.endsWith("…"));
  });
});
