import { PublicKey } from "@solana/web3.js";
import { SlashCommandBuilder } from "discord.js";
import { formatPotDetails, formatPotList } from "./format";
import { filterPots, sortNewestFirst, type Pot, type PotFilter } from "./pots";
import type { PotSource } from "./source";

const POT_FILTERS: readonly PotFilter[] = ["active", "settled", "all"];

export function parsePotPageId(customId: string) {
  const match = /^pots:(active|settled|all):(\d+)$/.exec(customId);
  if (!match) return null;
  return {
    filter: match[1] as PotFilter,
    page: Number(match[2]),
  };
}

export function visiblePotPage(
  pots: Pot[],
  filter: PotFilter,
  page: number,
) {
  const visible = sortNewestFirst(filterPots(pots, filter));
  return {
    visible,
    page: Math.max(0, Math.min(page, visible.length - 1)),
  };
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("pots")
    .setDescription("List accountability pots, newest first")
    .addStringOption((option) =>
      option
        .setName("filter")
        .setDescription("Which pots to show (default: all)")
        .addChoices(
          { name: "active", value: "active" },
          { name: "settled", value: "settled" },
          { name: "all", value: "all" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("pot")
    .setDescription("Show a pot's participants, judge, outcome, and payout")
    .addStringOption((option) =>
      option
        .setName("address")
        .setDescription("Pot address, or the link from the app's Share button")
        .setRequired(true),
    ),
].map((command) => command.toJSON());

/** The subset of Discord's option resolver the commands use, so tests can pass plain objects. */
export type CommandOptions = {
  getString: (name: string) => string | null;
};

export type CommandContext = {
  source: PotSource;
  appUrl: string;
  now?: () => number;
};

/** Accept a bare address or the app's shared link, which ends in `#pot-<address>`. */
export function parsePotAddress(input: string) {
  const trimmed = input.trim();
  const fromLink = /pot-([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(trimmed)?.[1];
  try {
    return new PublicKey(fromLink ?? trimmed).toBase58();
  } catch {
    return null;
  }
}

/** Run a slash command and return the messages to send, first reply then follow-ups. */
export async function executeCommand(
  name: string,
  options: CommandOptions,
  context: CommandContext,
): Promise<string[]> {
  const formatContext = {
    appUrl: context.appUrl,
    nowSeconds: Math.floor((context.now ?? Date.now)() / 1000),
  };
  if (name === "pots") {
    const requested = options.getString("filter");
    const filter = POT_FILTERS.find((value) => value === requested) ?? "all";
    return formatPotList(await context.source.get(), filter, formatContext);
  }
  if (name === "pot") {
    const address = parsePotAddress(options.getString("address") ?? "");
    if (!address) {
      return [
        "That does not look like a pot address. Paste the address or the link from the app's Share button.",
      ];
    }
    const find = (pots: Pot[]) => pots.find((pot) => pot.address === address);
    const pot =
      find(await context.source.get()) ?? find(await context.source.refresh());
    if (!pot) return [`No pot found at \`${address}\` on this program.`];
    return [formatPotDetails(pot, formatContext)];
  }
  return [`Unknown command: /${name}`];
}
