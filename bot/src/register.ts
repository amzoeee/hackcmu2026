import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands";
import { loadEnvFile, readConfig, required } from "./config";

loadEnvFile();
const config = readConfig();
const token = required(config.discordBotToken, "DISCORD_BOT_TOKEN");
const clientId = required(config.discordClientId, "DISCORD_CLIENT_ID");
const guildId = required(config.discordGuildId, "DISCORD_GUILD_ID");

const rest = new REST({ version: "10" }).setToken(token);
const registered = (await rest.put(
  Routes.applicationGuildCommands(clientId, guildId),
  { body: commandDefinitions },
)) as unknown[];
console.log(
  `Registered ${registered.length} slash command(s) in guild ${guildId}: ${commandDefinitions
    .map((command) => `/${command.name}`)
    .join(", ")}`,
);
