import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { it } from "node:test";
import { SystemProgram } from "@solana/web3.js";
import { getReadOnlyConnection } from "../src/lib/anchor/client";

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
