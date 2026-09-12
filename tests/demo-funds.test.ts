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
});
