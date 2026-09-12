"use client";

import { BN } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  getAccountabilityProgram,
  getReadOnlyAccountabilityProgram,
} from "@/lib/anchor/client";

type PotAccount = {
  creator: PublicKey;
  judge: PublicKey;
  identifier: BN | bigint | number;
  task: string;
  stake: BN | bigint | number;
  deadline: BN | bigint | number;
  createdAt: BN | bigint | number;
  yesParticipants: PublicKey[];
  noParticipants: PublicKey[];
  settled: boolean;
  outcome: boolean | null;
};

type Pot = PotAccount & { publicKey: PublicKey };

type SolaraAppProps = {
  connection: Connection;
  wallet?: AnchorWallet;
  address?: string;
  onConnect: () => void;
  onDisconnect?: () => void;
  walletLabel: string;
};

const ONE_SOL = BigInt(LAMPORTS_PER_SOL);

function asBigInt(value: BN | bigint | number) {
  return typeof value === "bigint"
    ? value
    : typeof value === "number"
      ? BigInt(value)
      : BigInt(value.toString());
}

function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatSol(lamports: BN | bigint | number) {
  const value = Number(asBigInt(lamports)) / LAMPORTS_PER_SOL;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function parseSol(value: string) {
  if (!/^\d+(\.\d{1,9})?$/.test(value.trim())) {
    throw new Error("Enter a stake with up to 9 decimal places.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const lamports = BigInt(whole) * ONE_SOL + BigInt((fraction + "000000000").slice(0, 9));
  if (lamports <= 0n) throw new Error("Stake must be greater than zero.");
  return lamports;
}

function formatDeadline(deadline: BN | bigint | number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Number(asBigInt(deadline)) * 1000));
}

function timeRemaining(deadline: BN | bigint | number, now: number) {
  const seconds = Number(asBigInt(deadline)) - Math.floor(now / 1000);
  if (seconds <= 0) return "Deadline passed";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${Math.max(1, minutes)}m remaining`;
}

function identifierSeed(identifier: BN) {
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigUint64(0, BigInt(identifier.toString()), true);
  return seed;
}

function actionError(error: unknown) {
  if (error instanceof Error) return error.message.replace(/^Error: /, "");
  return "The transaction could not be completed. Please try again.";
}

export function SolaraApp({
  connection,
  wallet,
  address,
  onConnect,
  onDisconnect,
  walletLabel,
}: SolaraAppProps) {
  const [pots, setPots] = useState<Pot[]>([]);
  const [loadingPots, setLoadingPots] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [stake, setStake] = useState("0.01");
  const [deadline, setDeadline] = useState("");
  const [judge, setJudge] = useState("");

  const program = useMemo(
    () => (wallet ? getAccountabilityProgram(connection, wallet) : getReadOnlyAccountabilityProgram(connection)),
    [connection, wallet],
  );

  const refreshPots = useCallback(async () => {
    setLoadingPots(true);
    try {
      const accounts = (await program.account.pot.all()) as Array<{
        publicKey: PublicKey;
        account: PotAccount;
      }>;
      setPots(
        accounts
          .map(({ publicKey, account }) => ({ ...account, publicKey }))
          .sort((left, right) => Number(asBigInt(right.createdAt) - asBigInt(left.createdAt))),
      );
    } catch (fetchError) {
      setError(actionError(fetchError));
    } finally {
      setLoadingPots(false);
    }
  }, [program]);

  const refreshBalance = useCallback(async () => {
    if (!wallet) {
      setBalance(null);
      return;
    }
    try {
      setBalance(await connection.getBalance(wallet.publicKey, "confirmed"));
    } catch {
      setBalance(null);
    }
  }, [connection, wallet]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshPots(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshPots]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshBalance(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshBalance]);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const initial = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [address]);

  const afterTransaction = useCallback(
    async (message: string) => {
      setNotice(message);
      await Promise.all([refreshPots(), refreshBalance()]);
    },
    [refreshBalance, refreshPots],
  );

  async function createPot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!program || !wallet) return onConnect();
    setError(null);
    setNotice(null);
    try {
      const stakeLamports = parseSol(stake);
      const deadlineSeconds = Math.floor(new Date(deadline).getTime() / 1000);
      if (!task.trim()) throw new Error("Add a task description.");
      if (task.trim().length > 160) throw new Error("Task descriptions are limited to 160 characters.");
      if (!Number.isFinite(deadlineSeconds) || deadlineSeconds <= Math.floor(Date.now() / 1000)) {
        throw new Error("Choose a future deadline.");
      }
      const judgeKey = new PublicKey(judge.trim() || wallet.publicKey);
      const identifier = new BN(Date.now().toString());
      const [pot] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("pot"), wallet.publicKey.toBytes(), identifierSeed(identifier)],
        program.programId,
      );
      setPending("create");
      await program.methods
        .createPot(identifier, task.trim(), new BN(stakeLamports.toString()), new BN(deadlineSeconds), judgeKey)
        .accountsPartial({ creator: wallet.publicKey, pot, systemProgram: SystemProgram.programId })
        .rpc();
      setTask("");
      await afterTransaction("Pot created. Participants can now choose a side.");
    } catch (createError) {
      setError(actionError(createError));
    } finally {
      setPending(null);
    }
  }

  async function joinPot(pot: Pot, side: "yes" | "no") {
    if (!program || !wallet) return onConnect();
    setError(null);
    setNotice(null);
    try {
      const stakeLamports = asBigInt(pot.stake);
      if (balance !== null && BigInt(balance) < stakeLamports + 10_000n) {
        throw new Error("Insufficient SOL for this stake and its network fee.");
      }
      setPending(`join-${pot.publicKey.toBase58()}-${side}`);
      await program.methods
        .joinPot(side === "yes" ? { yes: {} } : { no: {} })
        .accountsPartial({
          participant: wallet.publicKey,
          pot: pot.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await afterTransaction(`Joined ${side.toUpperCase()}. Your stake is now in the pot.`);
    } catch (joinError) {
      setError(actionError(joinError));
    } finally {
      setPending(null);
    }
  }

  async function settlePot(pot: Pot, completed: boolean) {
    if (!program || !wallet) return onConnect();
    setError(null);
    setNotice(null);
    try {
      const winners = completed ? pot.yesParticipants : pot.noParticipants;
      const recipients = winners.length > 0 ? winners : [...pot.yesParticipants, ...pot.noParticipants];
      setPending(`settle-${pot.publicKey.toBase58()}`);
      await program.methods
        .settlePot(completed)
        .accounts({ judge: wallet.publicKey, pot: pot.publicKey })
        .remainingAccounts(
          recipients.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
        )
        .rpc();
      await afterTransaction(completed ? "Settled as completed. Winners have been paid." : "Settled as not completed. Winners have been paid.");
    } catch (settleError) {
      setError(actionError(settleError));
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Solara home">
          solara
        </a>
        <div className="wallet-area">
          {address ? (
            <>
              <span className="wallet-balance">
                {balance === null ? "Loading balance" : `${formatSol(balance)} SOL`}
              </span>
              <span className="wallet-address" title={address}>{shorten(address)}</span>
              {onDisconnect ? <button className="text-button" type="button" onClick={onDisconnect}>Sign out</button> : null}
            </>
          ) : (
            <button className="button button-primary" type="button" onClick={onConnect}>
              Continue with email or Google
            </button>
          )}
        </div>
      </header>

      <section className="page-heading" id="top">
        <p className="overline">Accountability stakes · Solana devnet</p>
        <h1>Commit in public. Settle in full.</h1>
        <p>Stake test SOL on a commitment. A named judge decides the outcome when time is up.</p>
      </section>

      {notice ? <div className="message message-success" role="status">{notice}</div> : null}
      {error ? <div className="message message-error" role="alert">{error}</div> : null}

      <div className="workspace">
        <section className="create-column" aria-labelledby="create-heading">
          <div className="section-heading">
            <p className="overline">New pot</p>
            <h2 id="create-heading">Define the commitment</h2>
          </div>
          <form className="create-form" onSubmit={createPot}>
            <label>
              Task
              <textarea value={task} onChange={(event) => setTask(event.target.value)} maxLength={160} placeholder="Run three times this week" />
            </label>
            <div className="form-grid">
              <label>
                Stake (SOL)
                <input value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" placeholder="0.01" />
              </label>
              <label>
                Deadline
                <input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </label>
            </div>
            <label>
              Judge wallet
              <input value={judge} onChange={(event) => setJudge(event.target.value)} placeholder="Defaults to your wallet" />
              <span className="field-note">The judge settles the pot after its deadline.</span>
            </label>
            <button className="button button-primary" type="submit" disabled={pending !== null}>
              {pending === "create" ? "Creating pot…" : wallet ? "Create pot" : "Connect to create"}
            </button>
          </form>
        </section>

        <section className="pots-column" aria-labelledby="pots-heading">
          <div className="pots-header">
            <div className="section-heading">
              <p className="overline">Open record</p>
              <h2 id="pots-heading">Pots</h2>
            </div>
            <button className="text-button" type="button" onClick={() => void refreshPots()}>Refresh</button>
          </div>

          {loadingPots ? <p className="empty-copy">Loading pots from devnet…</p> : null}
          {!loadingPots && pots.length === 0 ? (
            <div className="empty-state">
              <h3>No pots yet</h3>
              <p>Create the first commitment, then share the page for others to take a side.</p>
            </div>
          ) : null}
          <div className="pot-list">
            {pots.map((pot) => {
              const joinedYes = address ? pot.yesParticipants.some((person) => person.toBase58() === address) : false;
              const joinedNo = address ? pot.noParticipants.some((person) => person.toBase58() === address) : false;
              const joined = joinedYes || joinedNo;
              const deadlinePassed = Number(asBigInt(pot.deadline)) <= Math.floor(now / 1000);
              const isJudge = address === pot.judge.toBase58();
              const participantCount = pot.yesParticipants.length + pot.noParticipants.length;
              const settlementPending = pending === `settle-${pot.publicKey.toBase58()}`;
              return (
                <article className="pot-row" key={pot.publicKey.toBase58()}>
                  <div className="pot-main">
                    <div className="pot-title-line">
                      <h3>{pot.task}</h3>
                      <span className={pot.settled ? "status status-settled" : "status"}>
                        {pot.settled ? (pot.outcome ? "Completed" : "Not completed") : deadlinePassed ? "Ready to settle" : "Open"}
                      </span>
                    </div>
                    <dl className="pot-details">
                      <div><dt>Stake</dt><dd>{formatSol(pot.stake)} SOL</dd></div>
                      <div><dt>Deadline</dt><dd>{formatDeadline(pot.deadline)}</dd></div>
                      <div><dt>Judge</dt><dd>{shorten(pot.judge.toBase58())}</dd></div>
                    </dl>
                    {!pot.settled ? <p className="time-note">{timeRemaining(pot.deadline, now)} · {participantCount}/10 joined</p> : <p className="time-note">{participantCount} participants · settlement recorded on-chain</p>}
                  </div>
                  {!pot.settled && !deadlinePassed ? (
                    <div className="pot-actions">
                      <span className="side-count">YES {pot.yesParticipants.length} · NO {pot.noParticipants.length}</span>
                      {joined ? <span className="joined-note">You chose {joinedYes ? "YES" : "NO"}</span> : (
                        <div className="button-group">
                          <button className="button button-secondary" type="button" disabled={pending !== null || participantCount >= 10} onClick={() => void joinPot(pot, "yes")}>{pending === `join-${pot.publicKey.toBase58()}-yes` ? "Joining…" : "Join YES"}</button>
                          <button className="button button-secondary" type="button" disabled={pending !== null || participantCount >= 10} onClick={() => void joinPot(pot, "no")}>{pending === `join-${pot.publicKey.toBase58()}-no` ? "Joining…" : "Join NO"}</button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {!pot.settled && deadlinePassed && isJudge ? (
                    <div className="pot-actions settlement-actions">
                      <span className="side-count">Judge action</span>
                      <div className="button-group">
                        <button className="button button-primary" type="button" disabled={pending !== null} onClick={() => void settlePot(pot, true)}>{settlementPending ? "Settling…" : "Completed"}</button>
                        <button className="button button-secondary" type="button" disabled={pending !== null} onClick={() => void settlePot(pot, false)}>Not completed</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <footer className="app-footer">Uses devnet test SOL. {wallet ? `Connected with ${walletLabel}.` : "No wallet extension is required."}</footer>
    </main>
  );
}
