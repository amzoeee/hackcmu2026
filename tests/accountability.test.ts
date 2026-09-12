import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { AnchorProvider, Program, setProvider } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import type { Accountability } from "../src/lib/anchor/generated/accountability";

describe("accountability scaffold", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  // Read the fresh build, including its current program address.
  const idl = JSON.parse(
    readFileSync("target/idl/accountability.json", "utf8"),
  ) as Accountability;
  const program = new Program<Accountability>(idl, provider);

  it("deploys locally and confirms a signed smoke-test transaction", async () => {
    // Genesis-loaded programs become callable after the validator advances slots.
    const readyBy = Date.now() + 10_000;
    while ((await provider.connection.getSlot("confirmed")) < 2) {
      assert.ok(Date.now() < readyBy, "The local validator must advance slots");
      await setTimeout(200);
    }
    const account = await provider.connection.getAccountInfo(program.programId);
    assert.ok(account?.executable, "The built program must be deployed");
    const signature = await program.methods
      .initialize()
      .accounts({ signer: provider.wallet.publicKey })
      .rpc();
    let result = await provider.connection.getTransaction(signature, {
      commitment: "confirmed",
    });
    // Transaction-history indexing can lag signature confirmation on localnet.
    const indexedBy = Date.now() + 10_000;
    while (!result && Date.now() < indexedBy) {
      await setTimeout(200);
      result = await provider.connection.getTransaction(signature, {
        commitment: "confirmed",
      });
    }
    assert.ok(result, "The transaction must exist on the local validator");
    assert.equal(result.meta?.err, null);
    assert.ok(
      result.meta?.logMessages?.some((line) =>
        line.includes("Accountability scaffold ready"),
      ),
    );
  });
});
