import { fileURLToPath } from "node:url";

export const DEFAULT_SOLANA_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_APP_URL = "http://localhost:3000";
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
/** Floor for POLL_INTERVAL_MS so a misconfiguration cannot hammer the public RPC. */
export const MIN_POLL_INTERVAL_MS = 5_000;

export type Config = {
  discordBotToken: string | undefined;
  discordClientId: string | undefined;
  discordGuildId: string | undefined;
  discordChannelId: string | undefined;
  solanaRpcUrl: string;
  appUrl: string;
  pollIntervalMs: number;
};

/**
 * Load bot/.env into process.env. Variables already present in the environment
 * win, and a missing file is fine because every setting has a default or is
 * only required by the mode that uses it.
 */
export function loadEnvFile(
  path = fileURLToPath(new URL("../.env", import.meta.url)),
) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function httpUrl(name: string, value: string | undefined, fallback: string) {
  const candidate = optional(value) ?? fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https.`);
  }
  return candidate;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const interval = optional(env.POLL_INTERVAL_MS);
  const pollIntervalMs =
    interval === undefined ? DEFAULT_POLL_INTERVAL_MS : Number(interval);
  if (
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < MIN_POLL_INTERVAL_MS
  ) {
    throw new Error(
      `POLL_INTERVAL_MS must be a whole number of milliseconds, at least ${MIN_POLL_INTERVAL_MS}.`,
    );
  }
  return {
    discordBotToken: optional(env.DISCORD_BOT_TOKEN),
    discordClientId: optional(env.DISCORD_CLIENT_ID),
    discordGuildId: optional(env.DISCORD_GUILD_ID),
    discordChannelId: optional(env.DISCORD_CHANNEL_ID),
    solanaRpcUrl: httpUrl(
      "SOLANA_RPC_URL",
      env.SOLANA_RPC_URL,
      DEFAULT_SOLANA_RPC_URL,
    ),
    appUrl: httpUrl("APP_URL", env.APP_URL, DEFAULT_APP_URL),
    pollIntervalMs,
  };
}

/** Settings that only one mode needs are checked when that mode starts. */
export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required. Add it to bot/.env.`);
  return value;
}
