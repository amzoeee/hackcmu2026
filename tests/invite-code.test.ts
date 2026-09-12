import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  MAX_INVITE_CODE_BYTES,
  MIN_INVITE_CODE_BYTES,
  createInviteCode,
  inviteCodeHash,
} from "../src/lib/invite-code";

it("hashes an invite code together with the pot address", async () => {
  const pot = Keypair.generate().publicKey;
  const code = createInviteCode();
  const expected = createHash("sha256")
    .update(Buffer.concat([pot.toBuffer(), Buffer.from(code, "utf8")]))
    .digest();

  const hash = await inviteCodeHash(pot, code);
  assert.equal(hash.length, 32);
  assert.deepEqual(hash, Array.from(expected));

  // The same code on another pot hashes differently, so a hash cannot be
  // replayed and one precomputed table cannot cover every pot.
  const other = Keypair.generate().publicKey;
  assert.notDeepEqual(await inviteCodeHash(other, code), hash);
});

it("rejects codes the program or the ledger cannot carry safely", async () => {
  const pot = Keypair.generate().publicKey;
  await assert.rejects(
    inviteCodeHash(pot, "x".repeat(MIN_INVITE_CODE_BYTES - 1)),
    /at least/,
  );
  await assert.rejects(
    inviteCodeHash(pot, "x".repeat(MAX_INVITE_CODE_BYTES + 1)),
    /at most/,
  );
  // The limits count UTF-8 bytes, matching the program.
  await assert.rejects(inviteCodeHash(pot, "🙂".repeat(17)), /at most/);
  assert.equal((await inviteCodeHash(pot, "🙂".repeat(16))).length, 32);
});

it("generates codes with enough entropy to survive a public hash", () => {
  const code = createInviteCode();
  assert.equal(code.length, 16);
  assert.match(code, /^[23456789A-HJ-NP-Z]{16}$/);
  const codes = new Set(Array.from({ length: 500 }, () => createInviteCode()));
  assert.equal(codes.size, 500);
});
