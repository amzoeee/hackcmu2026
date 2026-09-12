import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import {
  AnchorError,
  AnchorProvider,
  BN,
  Program,
  setProvider,
} from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import type { Accountability } from "../src/lib/anchor/generated/accountability";

const STAKE = 100_000_000; // 0.1 SOL

describe("accountability pots", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const idl = JSON.parse(
    readFileSync("target/idl/accountability.json", "utf8"),
  ) as Accountability;
  const program = new Program<Accountability>(idl, provider);
  let identifier = 1;

  async function chainTime() {
    const clock = await provider.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    assert.ok(clock, "The validator must expose the Clock sysvar");
    return Number(clock.data.readBigInt64LE(32));
  }

  async function rejectsProgramError(action: Promise<unknown>, code: string) {
    await assert.rejects(action, (error: unknown) => {
      assert.ok(error instanceof AnchorError);
      assert.equal(error.error.errorCode.code, code);
      return true;
    });
  }

  async function fund(wallet: Keypair, amount = LAMPORTS_PER_SOL) {
    const signature = await provider.connection.requestAirdrop(
      wallet.publicKey,
      amount,
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
  }

  async function createPot(
    creator: Keypair,
    judge: PublicKey,
    deadlineOffsetSeconds = 6,
    options: { task?: string; stake?: number } = {},
  ) {
    const id = identifier++;
    const deadline = (await chainTime()) + deadlineOffsetSeconds;
    const task = options.task ?? `Task ${id}`;
    const [pot] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pot"),
        creator.publicKey.toBuffer(),
        new BN(id).toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    await program.methods
      .createPot(
        new BN(id),
        task,
        new BN(options.stake ?? STAKE),
        new BN(deadline),
        judge,
      )
      .accountsPartial({
        creator: creator.publicKey,
        pot,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    return { pot, deadline, task };
  }

  async function join(
    pot: PublicKey,
    participant: Keypair,
    side: "yes" | "no",
  ) {
    await program.methods
      .joinPot(side === "yes" ? { yes: {} } : { no: {} })
      .accountsPartial({
        participant: participant.publicKey,
        pot,
        systemProgram: SystemProgram.programId,
      })
      .signers([participant])
      .rpc();
  }

  async function settle(
    pot: PublicKey,
    judge: Keypair,
    completed: boolean,
    recipients: PublicKey[],
    writable = true,
  ) {
    await program.methods
      .settlePot(completed)
      .accounts({ judge: judge.publicKey, pot })
      .remainingAccounts(
        recipients.map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: writable,
        })),
      )
      .signers([judge])
      .rpc();
  }

  async function waitForDeadline(deadline: number) {
    // Use the same Clock sysvar as the program, rather than assuming the
    // validator's clock matches the machine running these tests.
    const timeout = Date.now() + 30_000;
    while ((await chainTime()) < deadline) {
      assert.ok(
        Date.now() < timeout,
        "Validator clock did not reach the deadline",
      );
      await setTimeout(200);
    }
  }

  it("rejects invalid pot definitions", async () => {
    const creator = Keypair.generate();
    await fund(creator, 3 * LAMPORTS_PER_SOL);

    await rejectsProgramError(
      createPot(creator, creator.publicKey, 3, { task: "" }),
      "TaskRequired",
    );
    await rejectsProgramError(
      createPot(creator, creator.publicKey, 3, { task: " \n\t " }),
      "TaskRequired",
    );
    await rejectsProgramError(
      createPot(creator, creator.publicKey, 3, { task: "x".repeat(161) }),
      "TaskTooLong",
    );
    await rejectsProgramError(
      createPot(creator, creator.publicKey, 3, { task: "🙂".repeat(41) }),
      "TaskTooLong",
    );
    await rejectsProgramError(
      createPot(creator, creator.publicKey, 3, { stake: 0 }),
      "InvalidStake",
    );
    await rejectsProgramError(
      createPot(creator, creator.publicKey, -1),
      "DeadlineMustBeFuture",
    );
  });

  it("stores a task at the UTF-8 limit and lets one creator create distinct pots", async () => {
    const creator = Keypair.generate();
    await fund(creator);
    const task = "🙂".repeat(40);
    const first = await createPot(creator, creator.publicKey, 6, { task });
    const second = await createPot(creator, creator.publicKey);
    assert.notEqual(first.pot.toBase58(), second.pot.toBase58());
    const account = await program.account.pot.fetch(first.pot);
    assert.equal(account.task, task);
    assert.equal(account.creator.toBase58(), creator.publicKey.toBase58());
    assert.equal(account.judge.toBase58(), creator.publicKey.toBase58());
    assert.equal(account.noParticipants.length, 0);
    assert.equal(account.settled, false);
    assert.equal(account.outcome, null);
  });

  it("creates a pot, rejects duplicate joins and pays the selected side", async () => {
    const creator = Keypair.generate();
    const yes = Keypair.generate();
    const no = Keypair.generate();
    await Promise.all([
      fund(creator, 3 * LAMPORTS_PER_SOL),
      fund(yes),
      fund(no),
    ]);
    const { pot, deadline, task } = await createPot(creator, creator.publicKey);

    const created = await program.account.pot.fetch(pot);
    const rentReserve = await provider.connection.getBalance(pot);
    assert.equal(created.task, task);
    assert.equal(created.stake.toString(), String(STAKE));
    assert.equal(created.yesParticipants.length, 0);

    const beforeYes = await provider.connection.getBalance(yes.publicKey);
    const beforeNo = await provider.connection.getBalance(no.publicKey);
    await join(pot, yes, "yes");
    await join(pot, no, "no");
    assert.equal(
      await provider.connection.getBalance(yes.publicKey),
      beforeYes - STAKE,
    );
    assert.equal(
      await provider.connection.getBalance(no.publicKey),
      beforeNo - STAKE,
    );
    assert.equal(
      await provider.connection.getBalance(pot),
      rentReserve + STAKE * 2,
    );
    await rejectsProgramError(join(pot, yes, "no"), "AlreadyParticipating");
    await rejectsProgramError(
      settle(pot, creator, true, [yes.publicKey]),
      "DeadlineNotReached",
    );

    const beforeWinner = await provider.connection.getBalance(yes.publicKey);
    await waitForDeadline(deadline);
    await settle(pot, creator, true, [yes.publicKey]);
    const settled = await program.account.pot.fetch(pot);
    assert.equal(settled.settled, true);
    assert.equal(settled.outcome, true);
    assert.equal(
      await provider.connection.getBalance(yes.publicKey),
      beforeWinner + STAKE * 2,
    );
    assert.equal(await provider.connection.getBalance(pot), rentReserve);
    await rejectsProgramError(
      settle(pot, creator, true, [yes.publicKey]),
      "PotSettled",
    );
    await rejectsProgramError(join(pot, creator, "yes"), "PotSettled");
  });

  for (const side of ["yes", "no"] as const) {
    it(`fits ten ${side.toUpperCase()} participants and a maximum-length task, rejects an eleventh, and refunds everyone`, async () => {
      const judge = Keypair.generate();
      const participants = [
        judge,
        ...Array.from({ length: 10 }, () => Keypair.generate()),
      ];
      await Promise.all([
        fund(judge, 3 * LAMPORTS_PER_SOL),
        ...participants.slice(1).map((wallet) => fund(wallet)),
      ]);
      const { pot, deadline } = await createPot(judge, judge.publicKey, 12, {
        task: "🙂".repeat(40),
      });
      const rentReserve = await provider.connection.getBalance(pot);
      const accountInfo = await provider.connection.getAccountInfo(pot);
      assert.equal(accountInfo?.data.length, 599);
      assert.equal(
        rentReserve,
        await provider.connection.getMinimumBalanceForRentExemption(599),
      );

      for (const participant of participants.slice(0, 10)) {
        await join(pot, participant, side);
      }
      await rejectsProgramError(join(pot, participants[10], "yes"), "PotFull");
      const account = await program.account.pot.fetch(pot);
      assert.equal(
        account.yesParticipants.length + account.noParticipants.length,
        10,
      );
      const recipients = participants
        .slice(0, 10)
        .map((wallet) => wallet.publicKey);
      const beforeRefunds = await Promise.all(
        recipients.map((wallet) => provider.connection.getBalance(wallet)),
      );
      await waitForDeadline(deadline);
      await settle(pot, judge, side === "no", recipients);
      const settled = await program.account.pot.fetch(pot);
      assert.equal(settled.settled, true);
      assert.equal(settled.outcome, side === "no");
      assert.equal(
        (await program.coder.accounts.encode("pot", settled)).length,
        599,
      );
      for (const [index, wallet] of recipients.entries()) {
        assert.equal(
          await provider.connection.getBalance(wallet),
          beforeRefunds[index] + STAKE,
        );
      }
      assert.equal(await provider.connection.getBalance(pot), rentReserve);
    });
  }

  it("does not record or charge a participant whose stake transfer fails", async () => {
    const judge = Keypair.generate();
    const participant = Keypair.generate();
    await Promise.all([fund(judge), fund(participant, STAKE - 1)]);
    const { pot } = await createPot(judge, judge.publicKey);
    const beforePot = await provider.connection.getBalance(pot);
    await assert.rejects(
      join(pot, participant, "yes"),
      /insufficient lamports/i,
    );
    assert.equal(
      await provider.connection.getBalance(participant.publicKey),
      STAKE - 1,
    );
    assert.equal(await provider.connection.getBalance(pot), beforePot);
    const account = await program.account.pot.fetch(pot);
    assert.equal(account.yesParticipants.length, 0);
    assert.equal(account.noParticipants.length, 0);
  });

  it("fits ten mixed participants and pays the NO side while preserving exact rent and division dust", async () => {
    const judge = Keypair.generate();
    const yesParticipants = Array.from({ length: 7 }, () => Keypair.generate());
    const noWinners = Array.from({ length: 3 }, () => Keypair.generate());
    await Promise.all([
      fund(judge, 3 * LAMPORTS_PER_SOL),
      ...yesParticipants.map((wallet) => fund(wallet)),
      ...noWinners.map((wallet) => fund(wallet)),
    ]);
    const { pot, deadline } = await createPot(judge, judge.publicKey, 12, {
      task: "x".repeat(160),
    });
    const rentReserve = await provider.connection.getBalance(pot);
    for (const participant of yesParticipants)
      await join(pot, participant, "yes");
    for (const winner of noWinners) await join(pot, winner, "no");

    const winnerBalances = await Promise.all(
      noWinners.map((wallet) =>
        provider.connection.getBalance(wallet.publicKey),
      ),
    );
    const loserBalances = await Promise.all(
      yesParticipants.map((wallet) =>
        provider.connection.getBalance(wallet.publicKey),
      ),
    );
    await waitForDeadline(deadline);
    await settle(
      pot,
      judge,
      false,
      noWinners.map((wallet) => wallet.publicKey),
    );

    const payout = Math.floor((STAKE * 10) / noWinners.length);
    for (const [index, winner] of noWinners.entries()) {
      assert.equal(
        await provider.connection.getBalance(winner.publicKey),
        winnerBalances[index] + payout,
      );
    }
    for (const [index, loser] of yesParticipants.entries()) {
      assert.equal(
        await provider.connection.getBalance(loser.publicKey),
        loserBalances[index],
      );
    }
    const settled = await program.account.pot.fetch(pot);
    assert.equal(settled.yesParticipants.length, 7);
    assert.equal(settled.noParticipants.length, 3);
    assert.equal(settled.outcome, false);
    assert.equal(
      (await program.coder.accounts.encode("pot", settled)).length,
      599,
    );
    assert.equal(
      await provider.connection.getBalance(pot),
      rentReserve + ((STAKE * 10) % noWinners.length),
    );
  });

  it("enforces judge authority, rejects bad recipient lists, and refunds one-sided pots", async () => {
    const judge = Keypair.generate();
    const participant = Keypair.generate();
    const secondParticipant = Keypair.generate();
    const stranger = Keypair.generate();
    await Promise.all([
      fund(judge, 3 * LAMPORTS_PER_SOL),
      fund(participant),
      fund(secondParticipant),
      fund(stranger),
    ]);
    const { pot, deadline } = await createPot(judge, judge.publicKey);
    const rentReserve = await provider.connection.getBalance(pot);
    await join(pot, participant, "yes");
    await join(pot, secondParticipant, "yes");
    await waitForDeadline(deadline);

    const recipients = [participant.publicKey, secondParticipant.publicKey];
    await rejectsProgramError(
      settle(pot, stranger, false, recipients),
      "UnauthorizedJudge",
    );
    await rejectsProgramError(
      settle(pot, judge, false, [stranger.publicKey]),
      "IncorrectRecipientCount",
    );
    await rejectsProgramError(
      settle(pot, judge, false, [...recipients, stranger.publicKey]),
      "IncorrectRecipientCount",
    );
    await rejectsProgramError(
      settle(pot, judge, false, [
        stranger.publicKey,
        secondParticipant.publicKey,
      ]),
      "InvalidPayoutRecipient",
    );
    await rejectsProgramError(
      settle(pot, judge, false, [...recipients].reverse()),
      "InvalidPayoutRecipient",
    );
    await rejectsProgramError(
      settle(pot, judge, false, [participant.publicKey, participant.publicKey]),
      "InvalidPayoutRecipient",
    );
    await rejectsProgramError(
      settle(pot, judge, false, recipients, false),
      "RecipientNotWritable",
    );
    assert.equal((await program.account.pot.fetch(pot)).settled, false);
    assert.equal(
      await provider.connection.getBalance(pot),
      rentReserve + STAKE * 2,
    );
    const beforeRefund = await provider.connection.getBalance(
      participant.publicKey,
    );
    const beforeSecondRefund = await provider.connection.getBalance(
      secondParticipant.publicKey,
    );
    await settle(pot, judge, false, recipients);
    assert.equal(
      await provider.connection.getBalance(participant.publicKey),
      beforeRefund + STAKE,
    );
    assert.equal(
      await provider.connection.getBalance(secondParticipant.publicKey),
      beforeSecondRefund + STAKE,
    );
    assert.equal(await provider.connection.getBalance(pot), rentReserve);
  });

  it("settles an empty pot without a payout and rejects late joins", async () => {
    const judge = Keypair.generate();
    const lateParticipant = Keypair.generate();
    await Promise.all([
      fund(judge, 3 * LAMPORTS_PER_SOL),
      fund(lateParticipant),
    ]);
    const empty = await createPot(judge, judge.publicKey);
    const rentReserve = await provider.connection.getBalance(empty.pot);
    await waitForDeadline(empty.deadline);
    await rejectsProgramError(
      join(empty.pot, lateParticipant, "yes"),
      "DeadlinePassed",
    );
    await settle(empty.pot, judge, true, []);
    const settled = await program.account.pot.fetch(empty.pot);
    assert.equal(settled.settled, true);
    assert.equal(settled.outcome, true);
    assert.equal(await provider.connection.getBalance(empty.pot), rentReserve);
  });
});
