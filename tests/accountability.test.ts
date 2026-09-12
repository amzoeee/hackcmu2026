import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { AnchorProvider, BN, Program, setProvider } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import type { Accountability } from "../src/lib/anchor/generated/accountability";

const STAKE = 100_000_000; // 0.1 SOL

describe("accountability pots", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const idl = JSON.parse(readFileSync("target/idl/accountability.json", "utf8")) as Accountability;
  const program = new Program<Accountability>(idl, provider);
  let identifier = 1;

  async function fund(wallet: Keypair, amount = LAMPORTS_PER_SOL) {
    const signature = await provider.connection.requestAirdrop(wallet.publicKey, amount);
    await provider.connection.confirmTransaction(signature, "confirmed");
  }

  async function createPot(creator: Keypair, judge: PublicKey, deadlineOffsetSeconds = 3) {
    const id = identifier++;
    const deadline = Math.floor(Date.now() / 1000) + deadlineOffsetSeconds;
    const [pot] = PublicKey.findProgramAddressSync(
      [Buffer.from("pot"), creator.publicKey.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    await program.methods
      .createPot(new BN(id), `Task ${id}`, new BN(STAKE), new BN(deadline), judge)
      .accountsPartial({ creator: creator.publicKey, pot, systemProgram: SystemProgram.programId })
      .signers([creator])
      .rpc();
    return { pot, deadline };
  }

  async function join(pot: PublicKey, participant: Keypair, side: "yes" | "no") {
    await program.methods
      .joinPot(side === "yes" ? { yes: {} } : { no: {} })
      .accountsPartial({ participant: participant.publicKey, pot, systemProgram: SystemProgram.programId })
      .signers([participant])
      .rpc();
  }

  async function settle(pot: PublicKey, judge: Keypair, completed: boolean, recipients: PublicKey[]) {
    await program.methods
      .settlePot(completed)
      .accounts({ judge: judge.publicKey, pot })
      .remainingAccounts(recipients.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
      .signers([judge])
      .rpc();
  }

  async function waitForDeadline(deadline: number) {
    // The local validator's Clock sysvar can trail wall time by a few slots.
    const milliseconds = Math.max(0, deadline * 1000 - Date.now() + 3_500);
    await setTimeout(milliseconds);
  }

  it("creates a pot, rejects duplicate joins and pays the selected side", async () => {
    const creator = Keypair.generate();
    const yes = Keypair.generate();
    const no = Keypair.generate();
    await Promise.all([fund(creator, 3 * LAMPORTS_PER_SOL), fund(yes), fund(no)]);
    const { pot, deadline } = await createPot(creator, creator.publicKey);

    const created = await program.account.pot.fetch(pot);
    assert.equal(created.task, "Task 1");
    assert.equal(created.stake.toString(), String(STAKE));
    assert.equal(created.yesParticipants.length, 0);

    await join(pot, yes, "yes");
    await join(pot, no, "no");
    await assert.rejects(join(pot, yes, "no"), /already joined|custom program error/i);
    await assert.rejects(settle(pot, creator, true, [yes.publicKey]), /deadline|custom program error/i);

    const beforeWinner = await provider.connection.getBalance(yes.publicKey);
    await waitForDeadline(deadline);
    await settle(pot, creator, true, [yes.publicKey]);
    const settled = await program.account.pot.fetch(pot);
    assert.equal(settled.settled, true);
    assert.equal(settled.outcome, true);
    assert.equal(await provider.connection.getBalance(yes.publicKey), beforeWinner + STAKE * 2);
    await assert.rejects(settle(pot, creator, true, [yes.publicKey]), /settled|custom program error/i);
  });

  it("enforces judge authority, rejects bad recipient lists, and refunds one-sided pots", async () => {
    const judge = Keypair.generate();
    const participant = Keypair.generate();
    const stranger = Keypair.generate();
    await Promise.all([fund(judge, 3 * LAMPORTS_PER_SOL), fund(participant), fund(stranger)]);
    const { pot, deadline } = await createPot(judge, judge.publicKey);
    await join(pot, participant, "yes");
    await waitForDeadline(deadline);

    await assert.rejects(settle(pot, stranger, false, [participant.publicKey]), /judge|custom program error/i);
    await assert.rejects(settle(pot, judge, false, [stranger.publicKey]), /recipient|custom program error/i);
    const beforeRefund = await provider.connection.getBalance(participant.publicKey);
    await settle(pot, judge, false, [participant.publicKey]);
    assert.equal(await provider.connection.getBalance(participant.publicKey), beforeRefund + STAKE);
  });

  it("settles an empty pot without a payout and rejects late joins", async () => {
    const judge = Keypair.generate();
    const lateParticipant = Keypair.generate();
    await Promise.all([fund(judge, 3 * LAMPORTS_PER_SOL), fund(lateParticipant)]);
    const empty = await createPot(judge, judge.publicKey);
    await waitForDeadline(empty.deadline);
    await assert.rejects(join(empty.pot, lateParticipant, "yes"), /deadline|custom program error/i);
    await settle(empty.pot, judge, true, []);
    const settled = await program.account.pot.fetch(empty.pot);
    assert.equal(settled.settled, true);
    assert.equal(settled.outcome, true);
  });
});
