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
  sendAndConfirmTransaction,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import type { Accountability } from "../../src/lib/anchor/generated/accountability";
import {
  encodeGroupTask,
  packGroupTransactions,
  parseGroupTask,
} from "../../src/lib/group-challenge";

const STAKE = 100_000_000; // 0.1 SOL
const GRACE_SECONDS = 300;
// Mirrors Pot::SPACE in the program: ten wallets, a 160-byte task and a 200-byte proof link.
const POT_SIZE = 803;

describe("accountability pots", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const idl = JSON.parse(
    readFileSync("target/idl/accountability.json", "utf8"),
  ) as Accountability;
  const program = new Program<Accountability>(idl, provider);
  const fixtures = JSON.parse(
    readFileSync("target/test-fixtures/manifest.json", "utf8"),
  ) as Record<
    string,
    { pot: string; rentReserve: number; donation: number; size: number }
  >;
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

  async function refund(
    pot: PublicKey,
    caller: Keypair,
    recipients: PublicKey[],
    writable = true,
  ) {
    await program.methods
      .refundPot()
      .accounts({ caller: caller.publicKey, pot })
      .remainingAccounts(
        recipients.map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: writable,
        })),
      )
      .signers([caller])
      .rpc();
  }

  async function snapshot(pot: PublicKey, wallets: PublicKey[]) {
    return Promise.all(
      [pot, ...wallets].map(async (key) => {
        const account = await provider.connection.getAccountInfo(key);
        return (
          account && {
            lamports: account.lamports,
            data: account.data.toString("base64"),
          }
        );
      }),
    );
  }

  async function rejectsWithoutChanges(
    pot: PublicKey,
    wallets: PublicKey[],
    action: () => Promise<unknown>,
    code: string,
  ) {
    const before = await snapshot(pot, wallets);
    await rejectsProgramError(action(), code);
    assert.deepEqual(await snapshot(pot, wallets), before);
  }

  async function submitProof(pot: PublicKey, submitter: Keypair, uri: string) {
    await program.methods
      .submitProof(uri)
      .accounts({ submitter: submitter.publicKey, pot })
      .signers([submitter])
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

  it("rejects deadlines whose refund cutoff would overflow and a pot named as its own judge", async () => {
    const creator = Keypair.generate();
    await fund(creator);
    for (const invalid of ["deadline", "judge"]) {
      const id = new BN(identifier++);
      const [pot] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("pot"),
          creator.publicKey.toBuffer(),
          id.toArrayLike(Buffer, "le", 8),
        ],
        program.programId,
      );
      const deadline =
        invalid === "deadline"
          ? new BN("9223372036854775807")
          : new BN((await chainTime()) + 60);
      await rejectsWithoutChanges(
        pot,
        [creator.publicKey],
        () =>
          program.methods
            .createPot(
              id,
              "Invalid definition",
              new BN(STAKE),
              deadline,
              invalid === "judge" ? pot : creator.publicKey,
            )
            .accountsPartial({
              creator: creator.publicKey,
              pot,
              systemProgram: SystemProgram.programId,
            })
            .signers([creator])
            .rpc(),
        invalid === "deadline" ? "InvalidDeadline" : "InvalidJudge",
      );
    }
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
    await rejectsWithoutChanges(
      pot,
      [yes.publicKey, no.publicKey],
      () => refund(pot, no, [yes.publicKey, no.publicKey]),
      "RefundNotAvailable",
    );

    const beforeWinner = await provider.connection.getBalance(yes.publicKey);
    await waitForDeadline(deadline);
    await rejectsWithoutChanges(
      pot,
      [yes.publicKey, no.publicKey],
      () => refund(pot, no, [yes.publicKey, no.publicKey]),
      "RefundNotAvailable",
    );
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
    await rejectsWithoutChanges(
      pot,
      [yes.publicKey, no.publicKey],
      () => refund(pot, no, [yes.publicKey, no.publicKey]),
      "PotSettled",
    );
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
      assert.equal(accountInfo?.data.length, POT_SIZE);
      assert.equal(
        rentReserve,
        await provider.connection.getMinimumBalanceForRentExemption(POT_SIZE),
      );

      for (const participant of participants.slice(0, 10)) {
        await join(pot, participant, side);
      }
      await rejectsProgramError(join(pot, participants[10], "yes"), "PotFull");
      await submitProof(pot, judge, "p".repeat(200));
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
      await settle(pot, judge, true, recipients);
      const settled = await program.account.pot.fetch(pot);
      assert.equal(settled.settled, true);
      assert.equal(settled.outcome, true);
      assert.equal(settled.proofUri, "p".repeat(200));
      assert.equal(
        (await program.coder.accounts.encode("pot", settled)).length,
        POT_SIZE,
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
    await submitProof(pot, yesParticipants[0], "p".repeat(200));

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
    assert.equal(settled.proofUri, "p".repeat(200));
    assert.equal(
      (await program.coder.accounts.encode("pot", settled)).length,
      POT_SIZE,
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
    const donation = 12_345;
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: pot,
          lamports: donation,
        }),
      ),
    );
    await waitForDeadline(deadline);

    const recipients = [participant.publicKey, secondParticipant.publicKey];
    await rejectsProgramError(
      settle(pot, stranger, true, recipients),
      "UnauthorizedJudge",
    );
    await rejectsProgramError(
      settle(pot, judge, true, [stranger.publicKey]),
      "IncorrectRecipientCount",
    );
    await rejectsProgramError(
      settle(pot, judge, true, [...recipients, stranger.publicKey]),
      "IncorrectRecipientCount",
    );
    await rejectsProgramError(
      settle(pot, judge, true, [
        stranger.publicKey,
        secondParticipant.publicKey,
      ]),
      "InvalidPayoutRecipient",
    );
    await rejectsProgramError(
      settle(pot, judge, true, [...recipients].reverse()),
      "InvalidPayoutRecipient",
    );
    await rejectsProgramError(
      settle(pot, judge, true, [participant.publicKey, participant.publicKey]),
      "InvalidPayoutRecipient",
    );
    await rejectsProgramError(
      settle(pot, judge, true, recipients, false),
      "RecipientNotWritable",
    );
    assert.equal((await program.account.pot.fetch(pot)).settled, false);
    assert.equal(
      await provider.connection.getBalance(pot),
      rentReserve + STAKE * 2 + donation,
    );
    const beforeRefund = await provider.connection.getBalance(
      participant.publicKey,
    );
    const beforeSecondRefund = await provider.connection.getBalance(
      secondParticipant.publicKey,
    );
    await settle(pot, judge, true, recipients);
    assert.equal(
      await provider.connection.getBalance(participant.publicKey),
      beforeRefund + STAKE,
    );
    assert.equal(
      await provider.connection.getBalance(secondParticipant.publicKey),
      beforeSecondRefund + STAKE,
    );
    assert.equal(
      await provider.connection.getBalance(pot),
      rentReserve + donation,
    );
  });

  for (const side of ["yes", "no"] as const) {
    it(`forfeits an unopposed ${side.toUpperCase()} pot to its judge when the task was not completed`, async () => {
      const judge = Keypair.generate();
      const participant = Keypair.generate();
      const other = side === "yes" ? judge : Keypair.generate();
      await Promise.all([
        fund(judge, 3 * LAMPORTS_PER_SOL),
        fund(participant),
        ...(other === judge ? [] : [fund(other)]),
      ]);
      const { pot, deadline } = await createPot(judge, judge.publicKey);
      const rentReserve = await provider.connection.getBalance(pot);
      await join(pot, participant, side);
      await join(pot, other, side);
      const donation = 12_345;
      await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: provider.publicKey,
            toPubkey: pot,
            lamports: donation,
          }),
        ),
      );
      await waitForDeadline(deadline);

      const watched = [judge.publicKey, participant.publicKey, other.publicKey];
      await rejectsWithoutChanges(
        pot,
        watched,
        () => settle(pot, judge, false, []),
        "IncorrectRecipientCount",
      );
      await rejectsWithoutChanges(
        pot,
        watched,
        () => settle(pot, judge, false, [participant.publicKey]),
        "InvalidPayoutRecipient",
      );
      await rejectsWithoutChanges(
        pot,
        watched,
        () =>
          settle(pot, judge, false, [participant.publicKey, other.publicKey]),
        "IncorrectRecipientCount",
      );
      const beforeJudge = await provider.connection.getBalance(judge.publicKey);
      const beforeParticipant = await provider.connection.getBalance(
        participant.publicKey,
      );
      const beforeOther = await provider.connection.getBalance(other.publicKey);
      await settle(pot, judge, false, [judge.publicKey]);
      assert.equal(
        await provider.connection.getBalance(judge.publicKey),
        beforeJudge + 2 * STAKE,
      );
      assert.equal(
        await provider.connection.getBalance(participant.publicKey),
        beforeParticipant,
      );
      if (other !== judge) {
        assert.equal(
          await provider.connection.getBalance(other.publicKey),
          beforeOther,
        );
      }
      assert.equal(
        await provider.connection.getBalance(pot),
        rentReserve + donation,
      );
      const account = await program.account.pot.fetch(pot);
      assert.equal(account.settled, true);
      assert.equal(account.outcome, false);
    });
  }

  for (const name of ["mixed", "yes", "no", "empty"]) {
    it(`lets a stranger refund every exact stake from an expired ${name} pot while preserving rent and donations`, async () => {
      const fixture = fixtures[name];
      const pot = new PublicKey(fixture.pot);
      const judge = Keypair.fromSeed(Buffer.alloc(32, 72));
      const caller = Keypair.generate();
      await Promise.all([fund(caller), fund(judge)]);
      const account = await program.account.pot.fetch(pot);
      const recipients = [
        ...account.yesParticipants,
        ...account.noParticipants,
      ];
      assert.ok(
        (await chainTime()) >= account.deadline.toNumber() + GRACE_SECONDS,
      );
      assert.equal(account.settled, false);
      assert.equal(
        await provider.connection.getMinimumBalanceForRentExemption(
          fixture.size,
        ),
        fixture.rentReserve,
      );
      assert.equal(
        await provider.connection.getBalance(pot),
        fixture.rentReserve + recipients.length * STAKE + fixture.donation,
      );
      const watched = [...recipients, judge.publicKey, caller.publicKey];
      await rejectsWithoutChanges(
        pot,
        watched,
        () => settle(pot, judge, true, recipients),
        "SettlementWindowExpired",
      );
      await rejectsWithoutChanges(
        pot,
        watched,
        () => settle(pot, judge, false, recipients),
        "SettlementWindowExpired",
      );
      await rejectsWithoutChanges(
        pot,
        watched,
        () => join(pot, caller, "yes"),
        "DeadlinePassed",
      );
      const before = await Promise.all(
        recipients.map((key) => provider.connection.getBalance(key)),
      );
      const beforeCaller = await provider.connection.getBalance(
        caller.publicKey,
      );
      await refund(pot, caller, recipients);
      const refunded = await program.account.pot.fetch(pot);
      assert.equal(refunded.settled, true);
      assert.equal(refunded.outcome, null);
      for (const [index, key] of recipients.entries()) {
        assert.equal(
          await provider.connection.getBalance(key),
          before[index] + STAKE,
        );
      }
      assert.equal(
        await provider.connection.getBalance(caller.publicKey),
        beforeCaller,
      );
      assert.equal(
        await provider.connection.getBalance(pot),
        fixture.rentReserve + fixture.donation,
      );
      assert.equal(
        (await provider.connection.getAccountInfo(pot))?.data.length,
        fixture.size,
      );
      await rejectsWithoutChanges(
        pot,
        watched,
        () => refund(pot, caller, recipients),
        "PotSettled",
      );
      await rejectsWithoutChanges(
        pot,
        watched,
        () => settle(pot, judge, true, recipients),
        "PotSettled",
      );
    });
  }

  it("validates the complete ordered timeout-refund recipient list before moving any SOL", async () => {
    const pot = new PublicKey(fixtures["invalid-recipients"].pot);
    const caller = Keypair.generate();
    await fund(caller);
    const account = await program.account.pot.fetch(pot);
    const recipients = [...account.yesParticipants, ...account.noParticipants];
    const watched = [...recipients, caller.publicKey];
    for (const invalid of [
      recipients.slice(1),
      [...recipients, caller.publicKey],
    ]) {
      await rejectsWithoutChanges(
        pot,
        watched,
        () => refund(pot, caller, invalid),
        "IncorrectRecipientCount",
      );
    }
    for (const invalid of [
      [...recipients].reverse(),
      [caller.publicKey, ...recipients.slice(1)],
      [recipients[1], ...recipients.slice(1)],
    ]) {
      await rejectsWithoutChanges(
        pot,
        watched,
        () => refund(pot, caller, invalid),
        "InvalidPayoutRecipient",
      );
    }
    await rejectsWithoutChanges(
      pot,
      watched,
      () => refund(pot, caller, recipients, false),
      "RecipientNotWritable",
    );
    await refund(pot, caller, recipients);
    assert.equal((await program.account.pot.fetch(pot)).outcome, null);
  });

  it("rejects timeout refunds when the pot cannot return every full stake without consuming rent", async () => {
    const pot = new PublicKey(fixtures.underfunded.pot);
    const caller = Keypair.generate();
    await fund(caller);
    const account = await program.account.pot.fetch(pot);
    const recipients = [...account.yesParticipants, ...account.noParticipants];
    await rejectsWithoutChanges(
      pot,
      [...recipients, caller.publicKey],
      () => refund(pot, caller, recipients),
      "InsufficientPotBalance",
    );
  });

  it("accepts proof links from the creator or a YES participant until settlement", async () => {
    const creator = Keypair.generate();
    const yes = Keypair.generate();
    const no = Keypair.generate();
    const outsider = Keypair.generate();
    await Promise.all([
      fund(creator, 3 * LAMPORTS_PER_SOL),
      fund(yes),
      fund(no),
      fund(outsider),
    ]);
    const { pot, deadline } = await createPot(creator, creator.publicKey, 8);
    assert.equal((await program.account.pot.fetch(pot)).proofUri, "");
    await join(pot, yes, "yes");
    await join(pot, no, "no");

    await submitProof(pot, creator, "https://example.com/proof/1");
    assert.equal(
      (await program.account.pot.fetch(pot)).proofUri,
      "https://example.com/proof/1",
    );
    const longest = "x".repeat(200);
    await submitProof(pot, yes, longest);
    assert.equal((await program.account.pot.fetch(pot)).proofUri, longest);

    const rejected: Array<[Keypair, string, string]> = [
      [no, "https://example.com/no", "UnauthorizedProof"],
      [outsider, "https://example.com/outsider", "UnauthorizedProof"],
      [creator, "x".repeat(201), "ProofTooLong"],
      [creator, "🙂".repeat(51), "ProofTooLong"],
      [creator, "", "ProofRequired"],
      [creator, " \n\t ", "ProofRequired"],
    ];
    for (const [submitter, uri, code] of rejected) {
      await rejectsProgramError(submitProof(pot, submitter, uri), code);
      assert.equal((await program.account.pot.fetch(pot)).proofUri, longest);
    }

    await waitForDeadline(deadline);
    await settle(pot, creator, true, [yes.publicKey]);
    await rejectsProgramError(
      submitProof(pot, creator, "https://example.com/late"),
      "PotSettled",
    );
    const settled = await program.account.pot.fetch(pot);
    assert.equal(settled.settled, true);
    assert.equal(settled.proofUri, longest);
  });

  it("settles an empty pot without a payout and rejects late joins", async () => {
    const judge = Keypair.generate();
    const lateParticipant = Keypair.generate();
    await Promise.all([
      fund(judge, 3 * LAMPORTS_PER_SOL),
      fund(lateParticipant),
    ]);
    const empty = await createPot(judge, judge.publicKey);
    const emptyFailed = await createPot(judge, judge.publicKey);
    const rentReserve = await provider.connection.getBalance(empty.pot);
    await waitForDeadline(emptyFailed.deadline);
    await rejectsProgramError(
      join(empty.pot, lateParticipant, "yes"),
      "DeadlinePassed",
    );
    await settle(empty.pot, judge, true, []);
    const settled = await program.account.pot.fetch(empty.pot);
    assert.equal(settled.settled, true);
    assert.equal(settled.outcome, true);
    assert.equal(await provider.connection.getBalance(empty.pot), rentReserve);
    await settle(emptyFailed.pot, judge, false, []);
    const failed = await program.account.pot.fetch(emptyFailed.pot);
    assert.equal(failed.settled, true);
    assert.equal(failed.outcome, false);
    assert.equal(
      await provider.connection.getBalance(emptyFailed.pot),
      rentReserve,
    );
  });

  it("creates five grouped pots in one signature, stakes the organizer as skeptic, and settles each task independently", async () => {
    const organizer = Keypair.generate();
    const friends = Array.from({ length: 5 }, () => Keypair.generate());
    await Promise.all([
      fund(organizer, 3 * LAMPORTS_PER_SOL),
      ...friends.map((friend) => fund(friend)),
    ]);
    const deadline = (await chainTime()) + 10;
    const groupId = "1234abcd";
    const pots: PublicKey[] = [];
    const instructions = await Promise.all(
      friends.map(async (friend, index) => {
        const id = new BN(identifier++);
        const [pot] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("pot"),
            organizer.publicKey.toBuffer(),
            id.toArrayLike(Buffer, "le", 8),
          ],
          program.programId,
        );
        pots.push(pot);
        return program.methods
          .createPot(
            id,
            encodeGroupTask(groupId, friend.publicKey, `Task ${index + 1}`),
            new BN(STAKE),
            new BN(deadline),
            organizer.publicKey,
          )
          .accountsPartial({
            creator: organizer.publicKey,
            pot,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
      }),
    );
    const creates = packGroupTransactions(instructions, organizer.publicKey);
    assert.equal(
      creates.length,
      1,
      "All five short group tasks should share a create transaction",
    );
    const beforeCreate = await provider.connection.getBalance(
      organizer.publicKey,
    );
    const createSignature = await sendAndConfirmTransaction(
      provider.connection,
      creates[0],
      [organizer],
      { commitment: "confirmed" },
    );
    const createTransaction = await provider.connection.getTransaction(
      createSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    assert.ok(createTransaction?.meta);
    assert.equal(createTransaction.transaction.signatures.length, 1);
    const rent =
      await provider.connection.getMinimumBalanceForRentExemption(POT_SIZE);
    assert.equal(
      await provider.connection.getBalance(organizer.publicKey),
      beforeCreate - 5 * rent - createTransaction.meta.fee,
    );
    for (const [index, pot] of pots.entries()) {
      const account = await program.account.pot.fetch(pot);
      assert.deepEqual(parseGroupTask(account.task), {
        groupId,
        participant: friends[index].publicKey.toBase58(),
        task: `Task ${index + 1}`,
      });
      assert.equal(account.creator.toBase58(), organizer.publicKey.toBase58());
      assert.equal(account.judge.toBase58(), organizer.publicKey.toBase58());
      assert.equal(
        account.yesParticipants.length + account.noParticipants.length,
        0,
      );
    }
    const noInstructions = await Promise.all(
      pots.map((pot) =>
        program.methods
          .joinPot({ no: {} })
          .accountsPartial({
            participant: organizer.publicKey,
            pot,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ),
    );
    const skepticTransactions = packGroupTransactions(
      noInstructions,
      organizer.publicKey,
    );
    assert.equal(skepticTransactions.length, 1);
    const beforeSkeptic = await provider.connection.getBalance(
      organizer.publicKey,
    );
    const skepticSignature = await sendAndConfirmTransaction(
      provider.connection,
      skepticTransactions[0],
      [organizer],
      { commitment: "confirmed" },
    );
    const skepticTransaction = await provider.connection.getTransaction(
      skepticSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    assert.ok(skepticTransaction?.meta);
    assert.equal(skepticTransaction.transaction.signatures.length, 1);
    assert.equal(
      await provider.connection.getBalance(organizer.publicKey),
      beforeSkeptic - 5 * STAKE - skepticTransaction.meta.fee,
    );
    for (const [index, friend] of friends.entries()) {
      const before = await provider.connection.getBalance(friend.publicKey);
      await join(pots[index], friend, "yes");
      assert.equal(
        await provider.connection.getBalance(friend.publicKey),
        before - STAKE,
      );
    }
    await waitForDeadline(deadline);
    const beforeJudge = await provider.connection.getBalance(
      organizer.publicKey,
    );
    const beforeFriends = await Promise.all(
      friends.map((friend) => provider.connection.getBalance(friend.publicKey)),
    );
    for (const [index, pot] of pots.entries()) {
      const completed = index % 2 === 0;
      await settle(pot, organizer, completed, [
        completed ? friends[index].publicKey : organizer.publicKey,
      ]);
      const account = await program.account.pot.fetch(pot);
      assert.equal(account.settled, true);
      assert.equal(account.outcome, completed);
      assert.equal(await provider.connection.getBalance(pot), rent);
      for (const unjudged of pots.slice(index + 1)) {
        assert.equal(
          (await program.account.pot.fetch(unjudged)).settled,
          false,
        );
      }
    }
    assert.equal(
      await provider.connection.getBalance(organizer.publicKey),
      beforeJudge + 4 * STAKE,
    );
    for (const [index, friend] of friends.entries()) {
      assert.equal(
        await provider.connection.getBalance(friend.publicKey),
        beforeFriends[index] + (index % 2 === 0 ? 2 * STAKE : 0),
      );
    }
  });
});
