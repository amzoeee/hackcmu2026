import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { createChainReader } from "./chain";
import {
  executeCommand,
  parsePotPageId,
  visiblePotPage,
} from "./commands";
import { loadEnvFile, readConfig, required } from "./config";
import {
  formatNewPotAnnouncement,
  formatPotDetails,
  formatPotListView,
  formatPotList,
  formatSettledAnnouncement,
} from "./format";
import { createLogger, describeError } from "./logger";
import { createPotSource } from "./source";
import {
  createSeenState,
  pollOnce,
  startPolling,
  type Announcement,
  type PollDeps,
} from "./watcher";

/** Slash commands reuse a read this recent instead of asking the RPC again. */
const COMMAND_CACHE_MS = 10_000;

loadEnvFile();
const config = readConfig();
const log = createLogger();
const reader = createChainReader(config.solanaRpcUrl, log);
const source = createPotSource(reader.readPots, COMMAND_CACHE_MS);
const formatContext = () => ({
  appUrl: config.appUrl,
  nowSeconds: Math.floor(Date.now() / 1000),
});
const render = (announcement: Announcement) =>
  announcement.kind === "new"
    ? formatNewPotAnnouncement(announcement.pot, formatContext())
    : formatSettledAnnouncement(announcement.pot, formatContext());

log.info(
  `Program ${reader.programId} via ${new URL(config.solanaRpcUrl).origin}; polling every ${config.pollIntervalMs} ms; app ${config.appUrl}`,
);

/** Seed the seen set now, then keep polling. Returns the stop function. */
async function startAnnouncer(post: (content: string) => Promise<void>) {
  const deps: PollDeps = {
    readPots: () => source.refresh(),
    state: createSeenState(),
    announce: (announcement) => post(render(announcement)),
    log,
  };
  const first = await pollOnce(deps);
  if (!first.ok) {
    log.warn("The seen set will be seeded by the next successful poll.");
  }
  return startPolling(deps, config.pollIntervalMs);
}

function printBlock(label: string, messages: string[]) {
  const body = messages.join("\n--- next message ---\n");
  console.log(`\n--- ${label} ---\n${body}\n--- end ---\n`);
}

if (config.dryRun) {
  const target = config.discordChannelId
    ? `channel ${config.discordChannelId}`
    : "channel (DISCORD_CHANNEL_ID is unset)";
  log.info(
    "Dry run: not connecting to Discord. Messages that would be posted are printed instead.",
  );
  const stop = await startAnnouncer(async (content) => {
    printBlock(`would post to ${target}`, [content]);
  });
  const pots = source.latest();
  if (pots) {
    printBlock(
      "preview of /pots all",
      formatPotList(pots, "all", formatContext()),
    );
    const newest = pots[0];
    if (newest) {
      printBlock(`preview of /pot ${newest.address}`, [
        formatPotDetails(newest, formatContext()),
      ]);
    }
  }
  const shutdown = () => {
    stop();
    log.info("Dry run stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const token = required(config.discordBotToken, "DISCORD_BOT_TOKEN");
  const channelId = required(config.discordChannelId, "DISCORD_CHANNEL_ID");
  // Slash commands need no privileged intents; Guilds keeps the channel cache warm.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let stop: (() => void) | undefined;
  // Pot tasks are on-chain text from anyone, so never let them ping people.
  const allowedMentions = { parse: [] as never[] };

  client.once(Events.ClientReady, async (ready) => {
    log.info(`Connected to Discord as ${ready.user.tag}.`);
    try {
      const channel = await ready.channels.fetch(channelId);
      if (!channel?.isSendable()) {
        throw new Error(
          `Channel ${channelId} is not a text channel this bot can post in.`,
        );
      }
      stop = await startAnnouncer(async (content) => {
        await channel.send({ content, allowedMentions });
      });
    } catch (error) {
      log.warn(`Cannot start announcements: ${describeError(error)}`);
      process.exitCode = 1;
      await client.destroy();
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      const pageId = parsePotPageId(interaction.customId);
      if (!pageId) return;
      try {
        await interaction.deferUpdate();
        const pots = await source.get();
        const { page } = visiblePotPage(
          pots,
          pageId.filter,
          pageId.page,
        );
        const view = formatPotListView(
          pots,
          pageId.filter,
          formatContext(),
          page,
        );
        if (!view) {
          await interaction.editReply({
            content: "No pots match that filter anymore.",
            embeds: [],
            components: [],
          });
          return;
        }
        await interaction.editReply({
          content: "",
          embeds: [view.embed],
          components: view.components,
        });
      } catch (error) {
        log.warn(`Pot page change failed: ${describeError(error)}`);
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    try {
      // Reads can take up to the RPC timeout; Discord wants an acknowledgement within 3s.
      await interaction.deferReply();
      const options = {
        getString: (name: string) => interaction.options.getString(name),
      };
      if (interaction.commandName === "pots") {
        const requested = options.getString("filter");
        const filter =
          requested === "active" || requested === "settled" || requested === "all"
            ? requested
            : "all";
        const view = formatPotListView(
          await source.get(),
          filter,
          formatContext(),
          0,
        );
        if (view) {
          await interaction.editReply({
            content: "",
            embeds: [view.embed],
            components: view.components,
          });
        } else {
          const [empty] = await executeCommand("pots", options, {
            source,
            appUrl: config.appUrl,
          });
          await interaction.editReply({
            content: empty ?? "No pots yet.",
            allowedMentions,
          });
        }
        return;
      }
      const [first, ...rest] = await executeCommand(
        interaction.commandName,
        options,
        { source, appUrl: config.appUrl },
      );
      await interaction.editReply({
        content: first ?? "Nothing to show.",
        allowedMentions,
      });
      for (const content of rest) {
        await interaction.followUp({ content, allowedMentions });
      }
    } catch (error) {
      log.warn(`/${interaction.commandName} failed: ${describeError(error)}`);
      const content =
        "Could not read pots from Solana right now. Try again in a moment.";
      await (
        interaction.deferred || interaction.replied
          ? interaction.editReply({ content })
          : interaction.reply({ content, flags: MessageFlags.Ephemeral })
      ).catch(() => {});
    }
  });

  const shutdown = async () => {
    stop?.();
    await client.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await client.login(token);
}
