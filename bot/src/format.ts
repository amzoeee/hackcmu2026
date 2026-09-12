import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from "discord.js";
import {
  computePayout,
  filterPots,
  formatSol,
  MAX_PARTICIPANTS,
  participantCount,
  potLink,
  potStatus,
  sortNewestFirst,
  shorten,
  type Payout,
  type Pot,
  type PotFilter,
  type PotStatus,
} from "./pots";

/** Discord rejects message content longer than this. */
export const DISCORD_MESSAGE_LIMIT = 2000;

export type FormatContext = {
  appUrl: string;
  /** Unix seconds; passed in so formatting is deterministic in tests. */
  nowSeconds: number;
};

export type PotListView = {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
};

/** Discord renders `<t:unix:f>` as a local date and `<t:unix:R>` as "in 5 minutes". */
export function discordTimestamp(seconds: number) {
  const unix = Math.trunc(seconds);
  return `<t:${unix}:f> (<t:${unix}:R>)`;
}

export function describeStatus(status: PotStatus) {
  switch (status.kind) {
    case "active":
      return status.full ? "Active · full" : "Active";
    case "closed":
      return "Closed · awaiting judge";
    case "refundable":
      return "Closed · judge window expired, refund available";
    case "settled":
      return status.outcome === null
        ? "Settled · refunded, no verdict"
        : status.outcome
          ? "Settled · completed"
          : "Settled · not completed";
  }
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The same wording the app uses for settlement reviews and results. */
export function describePayout(payout: Payout, mode: "settled" | "projected") {
  switch (payout.kind) {
    case "empty":
      return mode === "settled"
        ? "Empty pot settled. No SOL to distribute."
        : "This pot is empty. It will settle without a payout.";
    case "refund": {
      const each = `${formatSol(payout.perParticipant)} SOL`;
      const who =
        payout.participants === 1
          ? "the only participant"
          : `all ${payout.participants} participants`;
      if (payout.reason === "timeout") {
        return mode === "settled"
          ? `The judge window expired, so ${who} got their original ${each} stake back, without a verdict.`
          : `If no verdict arrives in time, ${who} would get their original ${each} stake back.`;
      }
      return mode === "settled"
        ? `This pot was unopposed, so ${who} got their original ${each} stake back.`
        : `This pot is unopposed, so ${who} would get their original ${each} stake back.`;
    }
    case "forfeit": {
      const pool = `${formatSol(payout.pool)} SOL staked pool`;
      const judge = `the judge (\`${shorten(payout.judge)}\`)`;
      return mode === "settled"
        ? `This pot was unopposed, so the whole ${pool} went to ${judge}.`
        : `This pot is unopposed, so the whole ${pool} would go to ${judge}, including any stake the judge contributed.`;
    }
    case "winners": {
      const each = `${formatSol(payout.perWinner)} SOL`;
      const pool = `${formatSol(payout.pool)} SOL pool`;
      const recipients = `${plural(payout.winners, `${payout.side} participant`)}`;
      return mode === "settled"
        ? `The ${pool} was paid to ${recipients}: ${each} each, including their stake.`
        : `${recipients} would receive ${each} each from the ${pool}, including their stake.`;
    }
  }
}

function title(pot: Pot) {
  return `**${escapeMarkdown(pot.task)}**`;
}

function sides(pot: Pot) {
  return `YES ${pot.yesParticipants.length} · NO ${pot.noParticipants.length}`;
}

/** One list entry: task and status, then the numbers, then the app link. */
export function formatPotEntry(pot: Pot, context: FormatContext) {
  const status = describeStatus(potStatus(pot, context.nowSeconds));
  return [
    `${title(pot)} — ${status}`,
    `${formatSol(pot.stake)} SOL stake · ${sides(pot)} · deadline ${discordTimestamp(pot.deadline)}`,
    `<${potLink(context.appUrl, pot.address)}>`,
  ].join("\n");
}

/** Pack entries into as few messages as Discord's limit allows, in order. */
export function chunkMessages(
  entries: string[],
  separator = "\n\n",
  limit = DISCORD_MESSAGE_LIMIT,
) {
  const messages: string[] = [];
  let current = "";
  for (const rawEntry of entries) {
    const entry =
      rawEntry.length > limit ? `${rawEntry.slice(0, limit - 1)}…` : rawEntry;
    if (!current) {
      current = entry;
    } else if (current.length + separator.length + entry.length <= limit) {
      current += separator + entry;
    } else {
      messages.push(current);
      current = entry;
    }
  }
  if (current) messages.push(current);
  return messages;
}

/** The `/pots` reply, newest first, split across messages when needed. */
export function formatPotList(
  pots: Pot[],
  filter: PotFilter,
  context: FormatContext,
) {
  const visible = filterPots(pots, filter);
  if (visible.length === 0) {
    if (filter === "active") return ["No active pots right now."];
    if (filter === "settled") return ["No settled pots yet."];
    return [`No pots yet. Create one in the app: ${context.appUrl}`];
  }
  const label = filter === "all" ? "pot" : `${filter} pot`;
  const header = `**${plural(visible.length, label)}**, newest first`;
  return chunkMessages([
    header,
    ...visible.map((pot) => formatPotEntry(pot, context)),
  ]);
}

function participantList(side: "YES" | "NO", participants: string[]) {
  const names = participants.length
    ? participants.map((address) => `\`${shorten(address)}\``).join(", ")
    : "—";
  return `${side} (${participants.length}): ${names}`;
}

/** The `/pot <address>` reply. */
export function formatPotDetails(pot: Pot, context: FormatContext) {
  const status = potStatus(pot, context.nowSeconds);
  const count = participantCount(pot);
  const pool = pot.stake * BigInt(count);
  const payoutLines =
    status.kind === "settled"
      ? [
          `Payout: ${describePayout(computePayout(pot, status.outcome), "settled")}`,
        ]
      : [
          `If YES wins: ${describePayout(computePayout(pot, true), "projected")}`,
          `If NO wins: ${describePayout(computePayout(pot, false), "projected")}`,
        ];
  return [
    title(pot),
    `Status: ${describeStatus(status)}`,
    `Stake: ${formatSol(pot.stake)} SOL · Staked pool: ${formatSol(pool)} SOL · ${count}/${MAX_PARTICIPANTS} places filled`,
    `Deadline: ${discordTimestamp(pot.deadline)}`,
    `Created: ${discordTimestamp(pot.createdAt)}`,
    `Creator: \`${shorten(pot.creator)}\` · Judge: \`${shorten(pot.judge)}\``,
    participantList("YES", pot.yesParticipants),
    participantList("NO", pot.noParticipants),
    ...payoutLines,
    `Address: \`${pot.address}\``,
    potLink(context.appUrl, pot.address),
  ].join("\n");
}

/** Render one pot as a compact, website-like Discord embed. */
export function formatPotEmbed(
  pot: Pot,
  context: FormatContext,
  position: number,
  total: number,
) {
  const status = potStatus(pot, context.nowSeconds);
  const count = participantCount(pot);
  const pool = pot.stake * BigInt(count);
  const payout =
    status.kind === "settled"
      ? describePayout(computePayout(pot, status.outcome), "settled")
      : `YES: ${describePayout(computePayout(pot, true), "projected")}\nNO: ${describePayout(computePayout(pot, false), "projected")}`;

  const embed = new EmbedBuilder()
    .setTitle(pot.task)
    .setURL(potLink(context.appUrl, pot.address))
    .setDescription(describeStatus(status))
    .addFields(
      {
        name: "Stake",
        value: `${formatSol(pot.stake)} SOL each\n${formatSol(pool)} SOL staked`,
        inline: true,
      },
      {
        name: "Participants",
        value: `YES ${pot.yesParticipants.length} · NO ${pot.noParticipants.length}\n${count}/${MAX_PARTICIPANTS} places filled`,
        inline: true,
      },
      {
        name: "Deadline",
        value: discordTimestamp(pot.deadline),
        inline: false,
      },
      {
        name: "Judge",
        value: `\`${shorten(pot.judge)}\``,
        inline: true,
      },
      {
        name: "Created by",
        value: `\`${shorten(pot.creator)}\``,
        inline: true,
      },
      {
        name: status.kind === "settled" ? "Payout" : "Projected payout",
        value: payout,
        inline: false,
      },
    )
    .setFooter({ text: `Pot ${position + 1} of ${total} · ${pot.address}` });

  if (status.kind === "settled") {
    embed.setColor(
      status.outcome === null ? 0x6b7280 : status.outcome ? 0x2e8b57 : 0xc0392b,
    );
  } else if (status.kind === "closed" || status.kind === "refundable") {
    embed.setColor(0xd97706);
  } else {
    embed.setColor(0x2563eb);
  }
  return embed;
}

/** Build the paginated `/pots` response. */
export function formatPotListView(
  pots: Pot[],
  filter: PotFilter,
  context: FormatContext,
  page: number,
): PotListView | null {
  const visible = sortNewestFirst(filterPots(pots, filter));
  const pot = visible[page];
  if (!pot) return null;

  const previous = Math.max(0, page - 1);
  const next = Math.min(visible.length - 1, page + 1);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pots:${filter}:${previous}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`pots:${filter}:${next}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === visible.length - 1),
  );
  return {
    embed: formatPotEmbed(pot, context, page, visible.length),
    components: [row],
  };
}

/** Posted when a pot appears that the bot has not seen before. */
export function formatNewPotAnnouncement(pot: Pot, context: FormatContext) {
  return [
    `New pot: ${title(pot)}`,
    `${formatSol(pot.stake)} SOL stake · deadline ${discordTimestamp(pot.deadline)} · judge \`${shorten(pot.judge)}\` · ${sides(pot)}`,
    potLink(context.appUrl, pot.address),
  ].join("\n");
}

/** Posted when a known pot becomes settled. */
export function formatSettledAnnouncement(pot: Pot, context: FormatContext) {
  const payout = computePayout(pot, pot.outcome);
  const outcome =
    pot.outcome === null
      ? "Refunded (the judge window expired, so no verdict was recorded)"
      : pot.outcome
        ? "Completed (YES wins)"
        : "Not completed (NO wins)";
  return [
    `Settled: ${title(pot)} — ${outcome}`,
    describePayout(payout, "settled"),
    potLink(context.appUrl, pot.address),
  ].join("\n");
}
