import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_APP_URL,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SOLANA_RPC_URL,
  MIN_POLL_INTERVAL_MS,
  readConfig,
  required,
} from "../src/config";

describe("readConfig", () => {
  it("applies defaults when nothing is set", () => {
    assert.deepEqual(readConfig({}, []), {
      discordBotToken: undefined,
      discordClientId: undefined,
      discordGuildId: undefined,
      discordChannelId: undefined,
      solanaRpcUrl: DEFAULT_SOLANA_RPC_URL,
      appUrl: DEFAULT_APP_URL,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      dryRun: false,
    });
  });

  it("reads settings and enables dry run from the environment or the flag", () => {
    const config = readConfig(
      {
        DISCORD_BOT_TOKEN: " token ",
        DISCORD_CHANNEL_ID: "123",
        SOLANA_RPC_URL: "http://127.0.0.1:8899",
        APP_URL: "http://192.168.1.20:3000",
        POLL_INTERVAL_MS: "5000",
        DRY_RUN: "1",
      },
      [],
    );
    assert.equal(config.discordBotToken, "token");
    assert.equal(config.discordChannelId, "123");
    assert.equal(config.solanaRpcUrl, "http://127.0.0.1:8899");
    assert.equal(config.appUrl, "http://192.168.1.20:3000");
    assert.equal(config.pollIntervalMs, 5000);
    assert.equal(config.dryRun, true);
    assert.equal(readConfig({}, ["--dry-run"]).dryRun, true);
    assert.equal(readConfig({ DRY_RUN: "0" }, []).dryRun, false);
  });

  it("rejects poll intervals that would hammer the RPC and malformed URLs", () => {
    assert.throws(
      () =>
        readConfig({ POLL_INTERVAL_MS: String(MIN_POLL_INTERVAL_MS - 1) }, []),
      /POLL_INTERVAL_MS/,
    );
    assert.throws(
      () => readConfig({ POLL_INTERVAL_MS: "soon" }, []),
      /POLL_INTERVAL_MS/,
    );
    assert.throws(
      () => readConfig({ SOLANA_RPC_URL: "devnet" }, []),
      /SOLANA_RPC_URL/,
    );
    assert.throws(
      () => readConfig({ APP_URL: "ftp://example.com" }, []),
      /APP_URL/,
    );
  });

  it("names the missing setting", () => {
    assert.equal(required("x", "DISCORD_BOT_TOKEN"), "x");
    assert.throws(
      () => required(undefined, "DISCORD_BOT_TOKEN"),
      /DISCORD_BOT_TOKEN is required/,
    );
  });
});
