import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  Connection,
  Keypair,
  SystemInstruction,
  Transaction,
  type PublicKey,
  type TransactionConfirmationStrategy,
  type TransactionError,
} from "@solana/web3.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

function fundingRequest(address = Keypair.generate().publicKey.toBase58()) {
  return new Request("http://localhost/api/demo-funds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
}

test("demo funding verifies devnet before using the faucet or host key", async (t) => {
  // Node runs test files in separate processes. Load the route after fixing this
  // file's network config so it never inherits a developer's local RPC or key.
  process.env.NEXT_PUBLIC_SOLANA_NETWORK = "devnet";
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com";
  delete process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
  const { POST } = await import("../src/app/api/demo-funds/route");
  const folder = await mkdtemp(join(tmpdir(), "solara-funding-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const funder = Keypair.generate();
  const funderPath = join(folder, "funder.json");
  await writeFile(funderPath, JSON.stringify(Array.from(funder.secretKey)), {
    mode: 0o600,
  });

  let genesis = DEVNET_GENESIS;
  let genesisFailure = false;
  let balance = 0;
  let balanceReads = 0;
  let airdrops = 0;
  let transfers = 0;
  let confirmationError: TransactionError | null = null;
  const originalGetGenesisHash = Connection.prototype.getGenesisHash;
  t.mock.method(Connection.prototype, "getGenesisHash", async () => {
    if (genesisFailure) throw new Error("RPC unreachable");
    return genesis;
  });
  t.mock.method(Connection.prototype, "getBalance", async () => {
    balanceReads += 1;
    return balance;
  });
  t.mock.method(Connection.prototype, "getLatestBlockhash", async () => ({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 100,
  }));
  t.mock.method(Connection.prototype, "requestAirdrop", async () => {
    airdrops += 1;
    return "test-airdrop-signature";
  });
  t.mock.method(Connection.prototype, "confirmTransaction", async () => ({
    context: { slot: 1 },
    value: { err: confirmationError },
  }));
  t.mock.method(
    Connection.prototype,
    "sendTransaction",
    async (transaction: Transaction) => {
      transfers += 1;
      const transfer = SystemInstruction.decodeTransfer(
        transaction.instructions[0],
      );
      assert.equal(transfer.fromPubkey.toBase58(), funder.publicKey.toBase58());
      assert.equal(transfer.lamports, 250_000_000n);
      transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
      transaction.lastValidBlockHeight = 100;
      return "test-funder-signature";
    },
  );
  t.mock.method(console, "error", () => {});

  await t.test("wrong genesis cannot use a configured host key", async () => {
    process.env.SOLARA_DEMO_FUNDER_KEYPAIR = funderPath;
    genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dnb";
    const response = await POST(fundingRequest());
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /not Solana devnet/);
    assert.equal(balanceReads, 0);
    assert.equal(transfers, 0);
    assert.equal(airdrops, 0);
    delete process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
    genesis = DEVNET_GENESIS;
  });

  await t.test(
    "unreachable genesis fails closed and releases the wallet lock",
    async () => {
      genesisFailure = true;
      const address = Keypair.generate().publicKey.toBase58();
      const failed = await POST(fundingRequest(address));
      assert.equal(failed.status, 503);
      assert.match((await failed.json()).error, /Could not verify devnet/);
      assert.equal(balanceReads, 0);
      assert.equal(airdrops, 0);
      genesisFailure = false;
      balance = 50_000_000;
      assert.equal((await POST(fundingRequest(address))).status, 200);
    },
  );

  await t.test(
    "invalid addresses and funded wallets do not request SOL",
    async () => {
      assert.equal((await POST(fundingRequest("invalid"))).status, 400);
      balance = 50_000_000;
      const response = await POST(fundingRequest());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).funded, false);
      assert.equal(airdrops, 0);
      assert.equal(transfers, 0);
    },
  );

  await t.test(
    "verified faucet success returns a signature and prevents repeats",
    async () => {
      balance = 0;
      const address = Keypair.generate().publicKey.toBase58();
      const response = await POST(fundingRequest(address));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        funded: true,
        message: "Added 0.25 devnet SOL to this demo wallet.",
        signature: "test-airdrop-signature",
      });
      assert.equal(airdrops, 1);
      const repeated = await POST(fundingRequest(address));
      assert.equal(repeated.status, 429);
      assert.ok(Number(repeated.headers.get("Retry-After")) > 0);
      assert.equal(airdrops, 1);
    },
  );

  await t.test(
    "failed confirmations do not report funding or retain a lock",
    async () => {
      const address = Keypair.generate().publicKey.toBase58();
      confirmationError = { InstructionError: [0, { Custom: 1 }] };
      const failed = await POST(fundingRequest(address));
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).funded, undefined);
      confirmationError = null;
      assert.equal((await POST(fundingRequest(address))).status, 200);
    },
  );

  await t.test(
    "verified devnet transfers the fixed amount from the host key",
    async (subtest) => {
      process.env.SOLARA_DEMO_FUNDER_KEYPAIR = funderPath;
      subtest.mock.method(
        Connection.prototype,
        "getBalance",
        async (address: PublicKey) =>
          address.equals(funder.publicKey) ? 1_000_000_000 : 0,
      );
      const response = await POST(fundingRequest());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).signature, "test-funder-signature");
      assert.equal(transfers, 1);
      delete process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
    },
  );

  await t.test(
    "an unresponsive RPC is aborted and does not leave a pending lock",
    async (subtest) => {
      const controller = new AbortController();
      subtest.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        assert.equal(milliseconds, 30_000);
        return controller.signal;
      });
      subtest.mock.method(
        Connection.prototype,
        "getGenesisHash",
        originalGetGenesisHash,
      );
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let requests = 0;
      subtest.mock.method(
        globalThis,
        "fetch",
        async (_url: string | URL | Request, options?: RequestInit) => {
          requests += 1;
          const signal = options?.signal;
          assert.ok(signal);
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
            markStarted();
          });
        },
      );

      const address = Keypair.generate().publicKey.toBase58();
      const pending = POST(fundingRequest(address));
      await started;
      assert.equal((await POST(fundingRequest(address))).status, 429);
      controller.abort(new DOMException("Timed out", "TimeoutError"));
      const timedOut = await pending;
      assert.equal(timedOut.status, 504);
      assert.match((await timedOut.json()).error, /Check your balance/);
      assert.equal(timedOut.headers.get("Retry-After"), "60");
      const retried = await POST(fundingRequest(address));
      assert.equal(retried.status, 429);
      assert.match((await retried.json()).error, /recently requested/);
      assert.equal(requests, 1);
    },
  );

  for (const useHostKey of [false, true]) {
    await t.test(
      `${useHostKey ? "host transfer" : "faucet"} confirmation times out without sending twice`,
      async (subtest) => {
        if (useHostKey) process.env.SOLARA_DEMO_FUNDER_KEYPAIR = funderPath;
        subtest.after(() => {
          delete process.env.SOLARA_DEMO_FUNDER_KEYPAIR;
        });
        balance = 0;
        subtest.mock.method(
          Connection.prototype,
          "getBalance",
          async (address: PublicKey) =>
            address.equals(funder.publicKey) ? 1_000_000_000 : 0,
        );
        const controller = new AbortController();
        subtest.mock.method(AbortSignal, "timeout", () => controller.signal);
        let markConfirming!: () => void;
        const confirming = new Promise<void>((resolve) => {
          markConfirming = resolve;
        });
        subtest.mock.method(
          Connection.prototype,
          "confirmTransaction",
          async (strategy: TransactionConfirmationStrategy) => {
            const signal = strategy.abortSignal;
            assert.ok(signal);
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
              markConfirming();
            });
          },
        );

        const beforeAirdrops = airdrops;
        const beforeTransfers = transfers;
        const address = Keypair.generate().publicKey.toBase58();
        const pending = POST(fundingRequest(address));
        await confirming;
        controller.abort(new DOMException("Timed out", "TimeoutError"));
        assert.equal((await pending).status, 504);
        assert.equal((await POST(fundingRequest(address))).status, 429);
        assert.equal(airdrops - beforeAirdrops, useHostKey ? 0 : 1);
        assert.equal(transfers - beforeTransfers, useHostKey ? 1 : 0);
      },
    );
  }
});
