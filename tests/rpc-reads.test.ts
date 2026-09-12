import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { it } from "node:test";
import {
  AnchorError,
  AnchorProvider,
  BN,
  Wallet,
  utils,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  SendTransactionError,
  SystemProgram,
  Transaction,
  type TransactionError,
} from "@solana/web3.js";
import {
  fetchDecodablePots,
  getAccountabilityProgram,
  getReadOnlyAccountabilityProgram,
  getReadOnlyConnection,
} from "../src/lib/anchor/client";

it(
  "finishes slow RPC reads, aborts stalled reads, and recovers without rate-limit retries",
  { timeout: 35_000 },
  async () => {
    let mode: "slow" | "hang" | "limited" | "ready" = "slow";
    let requests = 0;
    const server = createServer(async (request, response) => {
      requests += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        id: string;
      };
      if (mode === "hang") return;
      if (mode === "limited") {
        response.writeHead(429).end("Rate limited");
        return;
      }
      const send = () =>
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { context: { slot: 1 }, value: 42 },
          }),
        );
      if (mode === "slow") setTimeout(send, 10_000);
      else send();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connection = getReadOnlyConnection(
      `http://127.0.0.1:${address.port}`,
    );

    try {
      const slowStarted = Date.now();
      assert.equal(await connection.getBalance(SystemProgram.programId), 42);
      assert.ok(Date.now() - slowStarted >= 9_500);

      mode = "hang";
      const stalledStarted = Date.now();
      await assert.rejects(
        connection.getBalance(SystemProgram.programId),
        /timeout|abort/i,
      );
      assert.ok(
        Date.now() - stalledStarted < 20_000,
        "A stalled read must release the caller",
      );

      mode = "limited";
      const beforeRateLimit = requests;
      await assert.rejects(
        connection.getBalance(SystemProgram.programId),
        /429/,
      );
      assert.equal(requests - beforeRateLimit, 1);

      mode = "ready";
      assert.equal(await connection.getBalance(SystemProgram.programId), 42);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it(
  "ends a stalled signed submission after 60 seconds and retains its signature through Anchor",
  { timeout: 75_000 },
  async (t) => {
    const blockhash = Keypair.generate().publicKey.toBase58();
    let submittedSignature = "";
    let submissions = 0;
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        id: string;
        method: string;
        params: string[];
      };
      if (body.method === "sendTransaction") {
        submissions += 1;
        const transaction = Transaction.from(
          Buffer.from(body.params[0], "base64"),
        );
        assert.ok(transaction.signature);
        submittedSignature = utils.bytes.bs58.encode(transaction.signature);
        return;
      }
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            context: { slot: 1 },
            value: { blockhash, lastValidBlockHeight: 100 },
          },
        }),
      );
    });
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const wallet = new Wallet(Keypair.generate());
    const program = getAccountabilityProgram(
      new Connection(`http://127.0.0.1:${address.port}`, "confirmed"),
      wallet,
    );
    const confirm = t.mock.method(
      program.provider.connection,
      "confirmTransaction",
      async () => {
        assert.fail("Confirmation cannot start without a submission response");
      },
    );
    const started = Date.now();
    await assert.rejects(
      program.methods
        .joinPot({ yes: {} }, null)
        .accountsPartial({
          participant: wallet.publicKey,
          pot: Keypair.generate().publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "Error");
        assert.match(error.message, /may have succeeded.*Check its status/);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /timeout|abort/i);
        assert.ok(submittedSignature);
        assert.equal(Reflect.get(error, "signature"), submittedSignature);
        return true;
      },
    );
    assert.ok(
      Date.now() - started >= 59_000,
      "Submission gets its full 60-second window",
    );
    assert.ok(
      Date.now() - started < 70_000,
      "A stalled send must release the caller",
    );
    assert.equal(
      submissions,
      1,
      "An uncertain submission must not be automatically sent again",
    );
    assert.equal(confirm.mock.callCount(), 0);
  },
);

it("preserves explicit submission errors and translates logged confirmation failures correctly", async (t) => {
  let mode: "transport" | "limited" | "preflight" | "confirmed" = "transport";
  const blockhash = Keypair.generate().publicKey.toBase58();
  const wallet = new Wallet(Keypair.generate());
  let submittedSignature = "";
  let submissions = 0;
  const logs = [
    "Program log: AnchorError occurred. Error Code: AlreadyParticipating. Error Number: 6007. Error Message: This wallet has already joined the pot.",
  ];
  const confirmationError = { InstructionError: [0, { Custom: 6007 }] };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      id: string;
      method: string;
      params: string[];
    };
    let result: unknown;
    if (body.method === "getLatestBlockhash") {
      result = {
        context: { slot: 1 },
        value: { blockhash, lastValidBlockHeight: 100 },
      };
    } else if (body.method === "sendTransaction") {
      submissions += 1;
      const transaction = Transaction.from(
        Buffer.from(body.params[0], "base64"),
      );
      assert.ok(transaction.signature);
      submittedSignature = utils.bytes.bs58.encode(transaction.signature);
      if (mode === "transport" || mode === "limited") {
        response
          .writeHead(mode === "limited" ? 429 : 500)
          .end("RPC unavailable");
        return;
      }
      if (mode === "preflight") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32002,
              message: "Transaction simulation failed: denied.",
              data: { logs: ["Program log: denied"] },
            },
          }),
        );
        return;
      }
      result = submittedSignature;
    } else {
      result = {
        slot: 2,
        meta: {
          err: confirmationError,
          fee: 5000,
          preBalances: [100000],
          postBalances: [95000],
          logMessages: logs,
        },
        transaction: {
          signatures: [submittedSignature],
          message: {
            accountKeys: [wallet.publicKey.toBase58()],
            header: {
              numRequiredSignatures: 1,
              numReadonlySignedAccounts: 0,
              numReadonlyUnsignedAccounts: 0,
            },
            instructions: [],
            recentBlockhash: blockhash,
          },
        },
      };
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const program = getAccountabilityProgram(
    new Connection(`http://127.0.0.1:${address.port}`, "confirmed"),
    wallet,
  );
  const join = program.methods.joinPot({ yes: {} }, null).accountsPartial({
    participant: wallet.publicKey,
    pot: Keypair.generate().publicKey,
    systemProgram: SystemProgram.programId,
  });
  const confirm = t.mock.method(
    program.provider.connection,
    "confirmTransaction",
    async () => ({
      context: { slot: 2 },
      value: { err: confirmationError },
    }),
  );
  for (const failure of ["transport", "limited"] as const) {
    mode = failure;
    const before = submissions;
    await assert.rejects(join.rpc(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /may have succeeded.*Check its status/);
      assert.doesNotMatch(
        error.message,
        /failed to fetch|fetch failed|network request|429|too many requests/i,
      );
      assert.equal(Reflect.get(error, "signature"), submittedSignature);
      return true;
    });
    assert.equal(submissions - before, 1);
  }
  mode = "preflight";
  for (const skipPreflight of [false, true]) {
    await assert.rejects(join.rpc({ skipPreflight }), (error: unknown) => {
      assert.ok(error instanceof SendTransactionError);
      assert.match(error.message, /denied/);
      assert.doesNotMatch(error.message, /may have succeeded|Unknown action/);
      assert.deepEqual(error.logs, ["Program log: denied"]);
      return true;
    });
  }
  assert.equal(confirm.mock.callCount(), 0);
  mode = "confirmed";
  await assert.rejects(join.rpc(), (error: unknown) => {
    assert.ok(error instanceof AnchorError);
    assert.equal(error.error.errorCode.code, "AlreadyParticipating");
    assert.equal(
      error.error.errorMessage,
      "This wallet has already joined the pot",
    );
    return true;
  });
  assert.equal(confirm.mock.callCount(), 1);
  // Outside Anchor's own log fetch, reading a failed transaction returns the
  // record rather than throwing.
  const record =
    await program.provider.connection.getTransaction(submittedSignature);
  assert.deepEqual(record?.meta?.err, confirmationError);
  assert.deepEqual(record?.meta?.logMessages, logs);
});

it(
  "bounds pre-sign and error-log reads without interrupting wallet approval or hiding confirmed errors",
  { timeout: 55_000 },
  async (t) => {
    let mode: "blockhash-hang" | "ready" | "logs-hang" | "logs-error" =
      "blockhash-hang";
    const blockhash = Keypair.generate().publicKey.toBase58();
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        id: string;
        method: string;
      };
      requests.push(body.method);
      if (body.method === "getLatestBlockhash") {
        if (mode === "blockhash-hang") return;
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              context: { slot: 1 },
              value: { blockhash, lastValidBlockHeight: 100 },
            },
          }),
        );
      } else if (body.method === "getTransaction" && mode === "logs-hang") {
        return;
      } else {
        response.writeHead(500).end("Transaction logs unavailable");
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const sharedConnection = new Connection(
      `http://127.0.0.1:${address.port}`,
      "confirmed",
    );
    const sharedBlockhashRead = sharedConnection.getLatestBlockhash;
    const sharedTransactionRead = sharedConnection.getTransaction;
    const wallet = new Wallet(Keypair.generate());
    let signCalls = 0;
    let approvalDelay = 0;
    const signTransaction = wallet.signTransaction.bind(wallet);
    wallet.signTransaction = async (transaction) => {
      signCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, approvalDelay));
      return signTransaction(transaction);
    };
    const provider = getAccountabilityProgram(sharedConnection, wallet)
      .provider as AnchorProvider;
    assert.notEqual(provider.connection, sharedConnection);
    assert.equal(sharedConnection.getLatestBlockhash, sharedBlockhashRead);
    assert.equal(sharedConnection.getTransaction, sharedTransactionRead);
    let confirmationError: TransactionError | null = null;
    const send = t.mock.method(
      provider.connection,
      "sendRawTransaction",
      async (raw: Parameters<Connection["sendRawTransaction"]>[0]) => {
        const transaction = Transaction.from(raw);
        assert.equal(transaction.recentBlockhash, blockhash);
        assert.ok(transaction.verifySignatures());
        return "submitted-signature";
      },
    );
    const confirm = t.mock.method(
      provider.connection,
      "confirmTransaction",
      async (signature: unknown, commitment: unknown) => {
        assert.equal(signature, "submitted-signature");
        assert.equal(commitment, "confirmed");
        return { context: { slot: 2 }, value: { err: confirmationError } };
      },
    );
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: SystemProgram.programId,
        lamports: 1,
      }),
    );

    try {
      const blockhashStarted = Date.now();
      await assert.rejects(
        provider.sendAndConfirm(transaction),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            "Could not prepare the transaction. Check your connection and try again.",
          );
          assert.ok(error.cause instanceof Error);
          assert.match(error.cause.message, /timeout|abort/i);
          return true;
        },
      );
      assert.ok(Date.now() - blockhashStarted < 20_000);
      assert.equal(
        signCalls,
        0,
        "A failed blockhash read must not prompt the wallet",
      );
      assert.equal(send.mock.callCount(), 0);
      assert.equal(confirm.mock.callCount(), 0);

      mode = "ready";
      approvalDelay = 16_000;
      const approvalStarted = Date.now();
      assert.equal(
        await provider.sendAndConfirm(transaction),
        "submitted-signature",
      );
      assert.ok(Date.now() - approvalStarted >= 15_500);
      assert.equal(signCalls, 1);
      assert.equal(send.mock.callCount(), 1);
      assert.equal(confirm.mock.callCount(), 1);

      approvalDelay = 0;
      confirmationError = { InstructionError: [0, { Custom: 6001 }] };
      mode = "logs-hang";
      const logsStarted = Date.now();
      await assert.rejects(
        provider.sendAndConfirm(transaction),
        /Raw transaction submitted-signature failed.*Custom.*6001/,
      );
      assert.ok(Date.now() - logsStarted < 20_000);

      mode = "logs-error";
      await assert.rejects(
        provider.sendAndConfirm(transaction),
        /Raw transaction submitted-signature failed.*Custom.*6001/,
      );
      assert.equal(
        requests.filter((method) => method === "getTransaction").length,
        2,
      );
      assert.equal(send.mock.callCount(), 3);
      assert.equal(confirm.mock.callCount(), 3);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it("skips pot accounts that do not decode instead of failing the whole read", async (t) => {
  const programId = Keypair.generate().publicKey;
  const responses: Array<{ pubkey: string; data: Buffer }> = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      id: string;
      method: string;
      params: [string, { filters?: unknown[] }];
    };
    assert.equal(body.method, "getProgramAccounts");
    assert.equal(body.params[1].filters?.length, 1);
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: responses.map(({ pubkey, data }) => ({
          pubkey,
          account: {
            lamports: 1,
            owner: programId.toBase58(),
            data: [data.toString("base64"), "base64"],
            executable: false,
            rentEpoch: 0,
            space: data.length,
          },
        })),
      }),
    );
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const program = getReadOnlyAccountabilityProgram(
    new Connection(`http://127.0.0.1:${address.port}`, "confirmed"),
  );
  const warn = t.mock.method(console, "warn", () => {});

  const participant = Keypair.generate().publicKey;
  const pot = {
    creator: Keypair.generate().publicKey,
    judge: Keypair.generate().publicKey,
    identifier: new BN(7),
    task: "Ship it",
    stake: new BN(100),
    deadline: new BN(2_000_000_000),
    createdAt: new BN(1_000),
    yesParticipants: [participant],
    noParticipants: [],
    settled: false,
    outcome: null,
    proofUri: "https://example.com/proof",
    accessHash: null,
  };
  const current = await program.coder.accounts.encode("pot", pot);
  // The previous layout ended at `outcome`. With an empty proof and no invite
  // hash, the current encoding is that layout plus five zero bytes.
  const legacyOf = (data: Buffer) => data.subarray(0, data.length - 5);
  const legacy = legacyOf(
    await program.coder.accounts.encode("pot", {
      ...pot,
      task: "Older pot",
      proofUri: "",
    }),
  );
  // Previous pots were allocated 599 bytes; a settled full one has no spare bytes.
  const paddedLegacy = Buffer.concat([
    legacy,
    Buffer.alloc(599 - legacy.length),
  ]);
  const fullLegacy = legacyOf(
    await program.coder.accounts.encode("pot", {
      ...pot,
      task: "x".repeat(160),
      yesParticipants: Array.from(
        { length: 10 },
        () => Keypair.generate().publicKey,
      ),
      settled: true,
      outcome: true,
      proofUri: "",
    }),
  );
  assert.equal(fullLegacy.length, 599);
  const garbage = Buffer.concat([
    current.subarray(0, 8),
    Buffer.from([1, 2, 3]),
  ]);
  const keys = Array.from({ length: 4 }, () => Keypair.generate().publicKey);
  responses.push(
    { pubkey: keys[0].toBase58(), data: current },
    { pubkey: keys[1].toBase58(), data: paddedLegacy },
    { pubkey: keys[2].toBase58(), data: fullLegacy },
    { pubkey: keys[3].toBase58(), data: garbage },
  );

  const pots = await fetchDecodablePots(program);
  assert.deepEqual(
    pots.map(({ publicKey }) => publicKey.toBase58()),
    [keys[0].toBase58(), keys[1].toBase58()],
  );
  assert.equal(pots[0].account.task, "Ship it");
  assert.equal(pots[0].account.proofUri, "https://example.com/proof");
  assert.equal(pots[1].account.task, "Older pot");
  assert.equal(pots[1].account.proofUri, "");
  assert.equal(pots[1].account.accessHash, null);
  assert.equal(
    pots[1].account.yesParticipants[0].toBase58(),
    participant.toBase58(),
  );
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    String(warn.mock.calls[0].arguments[0]),
    /Skipped 2 pot accounts/,
  );

  responses.length = 0;
  responses.push({ pubkey: keys[0].toBase58(), data: current });
  assert.equal((await fetchDecodablePots(program)).length, 1);
  assert.equal(warn.mock.callCount(), 1);
});
