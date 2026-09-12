import assert from "node:assert/strict";
import { it } from "node:test";
import { BN, BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type SignatureStatus,
} from "@solana/web3.js";
import idl from "../src/lib/anchor/generated/accountability.json";
import {
  encodeGroupTask,
  checkGroupSubmission,
  groupTaskBytes,
  parseGroupTask,
  packGroupTransactions,
} from "../src/lib/group-challenge";

const organizer = Keypair.generate();
const participant = Keypair.generate().publicKey;
const groupId = "1234abcd";

it("round-trips group tasks and enforces the complete UTF-8 byte budget", () => {
  const prefix = `[group:${groupId}:${participant.toBase58()}] `;
  const available = 160 - Buffer.byteLength(prefix);
  const task =
    "é".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
  const encoded = encodeGroupTask(groupId, participant, task);
  assert.equal(Buffer.byteLength(encoded), 160);
  assert.deepEqual(parseGroupTask(encoded), {
    groupId,
    participant: participant.toBase58(),
    task,
  });
  assert.throws(
    () => encodeGroupTask(groupId, participant, task + "é"),
    /160 UTF-8 bytes/,
  );
  assert.throws(
    () => encodeGroupTask(groupId, participant, "  "),
    /Add a task/,
  );
  assert.throws(
    () => encodeGroupTask("INVALID!", participant, "Task"),
    /identifier/,
  );
});

it("never counts a friend's row lower than its encoded size", () => {
  const address = participant.toBase58();
  const task = "é".repeat(40);
  assert.equal(
    groupTaskBytes(address, task),
    Buffer.byteLength(encodeGroupTask(groupId, participant, task)),
  );
  // A partly typed address must not read as cheaper than the finished one.
  for (const partial of ["", " ", address.slice(0, 20), "not-a-key"]) {
    assert.ok(groupTaskBytes(partial, task) >= groupTaskBytes(address, task));
  }
  // Trailing whitespace is trimmed before encoding, so it must not be counted.
  assert.equal(
    groupTaskBytes(` ${address} `, `  ${task}  `),
    groupTaskBytes(address, task),
  );
});

it("does not permit unresolved submissions to replay before finalized expiry", async () => {
  let height = 100;
  let status: SignatureStatus | null = null;
  const submission = {
    signature: "known-signature",
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 100,
  };
  const connection = {
    getSignatureStatuses: async () => ({
      context: { slot: 1 },
      value: [status],
    }),
    getBlockHeight: async (commitment: unknown) => {
      assert.equal(commitment, "finalized");
      return height;
    },
  };
  await assert.rejects(
    checkGroupSubmission(connection, submission),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(Reflect.get(error, "signature"), submission.signature);
      assert.match(error.message, /still unresolved/);
      return true;
    },
  );
  status = {
    slot: 1,
    confirmations: 0,
    err: null,
    confirmationStatus: "processed",
  };
  await assert.rejects(
    checkGroupSubmission(connection, submission),
    /still unresolved/,
  );
  height = 101;
  status = null;
  assert.equal(await checkGroupSubmission(connection, submission), "expired");
});

it("recognizes confirmation and failure, including a confirmation racing finalized expiry", async () => {
  const submission = {
    signature: "known-signature",
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 100,
  };
  let reads = 0;
  let status: SignatureStatus = {
    slot: 1,
    confirmations: 1,
    err: null,
    confirmationStatus: "confirmed",
  };
  const connection = {
    getSignatureStatuses: async () => {
      reads += 1;
      return { context: { slot: 1 }, value: [status] };
    },
    getBlockHeight: async () => {
      throw new Error("Resolved transactions need no expiry read");
    },
  };
  assert.equal(await checkGroupSubmission(connection, submission), "confirmed");
  assert.equal(reads, 1);
  status = {
    slot: 1,
    confirmations: 1,
    err: { InstructionError: [0, "Custom"] },
    confirmationStatus: "confirmed",
  };
  assert.equal(await checkGroupSubmission(connection, submission), "failed");
  reads = 0;
  status = {
    slot: 1,
    confirmations: 1,
    err: null,
    confirmationStatus: "confirmed",
  };
  assert.equal(
    await checkGroupSubmission(
      {
        getSignatureStatuses: async () => ({
          context: { slot: 1 },
          value: [++reads === 1 ? null : status],
        }),
        getBlockHeight: async () => 101,
      },
      submission,
    ),
    "confirmed",
  );
  assert.equal(reads, 2);
  await assert.rejects(
    checkGroupSubmission(
      {
        getSignatureStatuses: async () => {
          throw new Error("RPC unavailable");
        },
        getBlockHeight: async () => 101,
      },
      submission,
    ),
    /RPC unavailable/,
  );
});

it("keeps malformed tags visible and only parses a complete canonical prefix", () => {
  const valid = encodeGroupTask(groupId, participant, "Finish the pitch");
  for (const raw of [
    "Finish the pitch",
    `Discuss ${valid}`,
    valid.replace("1234abcd", "1234ABCD"),
    valid.replace(participant.toBase58(), "1".repeat(33)),
    valid.replace("] ", "]"),
    valid + " ",
    `[group:${groupId}:${participant.toBase58()}] `,
    valid + "🦀".repeat(160),
  ])
    assert.equal(parseGroupTask(raw), null, raw);
});

function createInstruction(index: number, taskLength: number) {
  const coder = new BorshInstructionCoder(idl as Idl);
  return new TransactionInstruction({
    programId: new PublicKey(idl.address),
    keys: [
      { pubkey: organizer.publicKey, isSigner: true, isWritable: true },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.encode("create_pot", {
      identifier: new BN(index),
      task: "x".repeat(taskLength),
      stake: new BN(10_000_000),
      deadline: new BN(2_000_000_000),
      judge: organizer.publicKey,
    }),
  });
}

it("batches real create instructions under 1232 bytes while preserving every instruction", () => {
  const instructions = Array.from({ length: 10 }, (_, index) =>
    createInstruction(index, 160),
  );
  const batches = packGroupTransactions(instructions, organizer.publicKey);
  assert.ok(batches.length > 1, "Ten maximum-length tasks must be split");
  assert.ok(
    batches[0].instructions.length >= 3,
    "Creates share a signature when they fit",
  );
  assert.deepEqual(
    batches.flatMap((batch) => batch.instructions),
    instructions,
  );
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    assert.equal(
      batch.recentBlockhash,
      undefined,
      "The provider prepares a fresh blockhash",
    );
    batch.recentBlockhash = Keypair.generate().publicKey.toBase58();
    batch.sign(organizer);
    assert.ok(batch.serialize().length <= 1232);
    assert.equal(batch.signatures.length, 1);
    if (index < batches.length - 1) {
      batch.add(batches[index + 1].instructions[0]);
      assert.throws(
        () =>
          batch.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        /too large|offset|bounds|overrun/i,
      );
    }
  }
});

it("fits five shorter creates under one signature and separates oversized or extra-signer instructions", () => {
  assert.equal(
    packGroupTransactions(
      Array.from({ length: 5 }, (_, index) => createInstruction(index, 60)),
      organizer.publicKey,
    ).length,
    1,
  );
  assert.deepEqual(packGroupTransactions([], organizer.publicKey), []);
  const oversized = createInstruction(0, 1);
  oversized.data = Buffer.alloc(1233);
  assert.throws(
    () => packGroupTransactions([oversized], organizer.publicKey),
    /1232-byte/,
  );
  const foreignSigner = SystemProgram.transfer({
    fromPubkey: participant,
    toPubkey: organizer.publicKey,
    lamports: 1,
  });
  assert.throws(
    () => packGroupTransactions([foreignSigner], organizer.publicKey),
    /organizer's signature/,
  );
});
