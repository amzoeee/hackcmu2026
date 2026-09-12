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
import { SOLANA_NETWORK, SOLANA_RPC_URL } from "@/lib/solana";

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
  onConnect: () => void | Promise<void>;
  onDisconnect?: () => void | Promise<void>;
  onRequestFunds?: () => Promise<string>;
  secondaryConnect?: { label: string; onClick: () => void };
  connectLabel: string;
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
    maximumFractionDigits: 9,
  });
}

function parseSol(value: string) {
  if (!/^\d+(\.\d{1,9})?$/.test(value.trim())) {
    throw new Error("Enter a stake with up to 9 decimal places.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const lamports =
    BigInt(whole) * ONE_SOL + BigInt((fraction + "000000000").slice(0, 9));
  if (lamports <= 0n) throw new Error("Stake must be greater than zero.");
  if (lamports > 18_446_744_073_709_551_615n) {
    throw new Error("This stake is too large. Enter a smaller SOL amount.");
  }
  return lamports;
}

function deadlineFromNow(minutes: number) {
  const date = new Date(Date.now() + minutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function explorerUrl(kind: "tx" | "address", value: string) {
  const cluster =
    SOLANA_NETWORK === "localnet"
      ? `custom&customUrl=${encodeURIComponent(SOLANA_RPC_URL)}`
      : SOLANA_NETWORK;
  return `https://explorer.solana.com/${kind}/${value}?cluster=${cluster}`;
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
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return minutes > 0
    ? `${minutes}m ${seconds % 60}s remaining`
    : `${seconds}s remaining`;
}

function identifierSeed(identifier: BN) {
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigUint64(
    0,
    BigInt(identifier.toString()),
    true,
  );
  return seed;
}

function actionError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message;
    const programMessage = message.match(/Error Message: ([^\n]+)/)?.[1];
    if (programMessage) return programMessage;
    if (/User rejected|User denied|rejected the request/i.test(message)) {
      return "The wallet request was cancelled. No action was taken.";
    }
    if (
      /insufficient (funds|lamports)|no record of a prior credit/i.test(message)
    ) {
      return "Your wallet needs more test SOL for this action and its network fee. Use Add test SOL, then try again.";
    }
    if (/blockhash not found|block height exceeded|expired/i.test(message)) {
      return "The transaction expired before confirmation. Refresh the pots and your balance before trying again.";
    }
    if (
      /failed to fetch|fetch failed|network request|429|too many requests/i.test(
        message,
      )
    ) {
      return "Devnet is not responding right now. Your last loaded pots are still shown. Try refreshing in a moment.";
    }
    return message.replace(/^Error: /, "").slice(0, 300);
  }
  return "The transaction could not be completed. Please try again.";
}

export function SolaraApp({
  connection,
  wallet,
  address,
  onConnect,
  onDisconnect,
  onRequestFunds,
  secondaryConnect,
  connectLabel,
  walletLabel,
}: SolaraAppProps) {
  const [pots, setPots] = useState<Pot[]>([]);
  const [loadingPots, setLoadingPots] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [programReady, setProgramReady] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [stake, setStake] = useState("0.01");
  const [deadline, setDeadline] = useState("");
  const [judge, setJudge] = useState("");
  const [settlement, setSettlement] = useState<{
    pot: string;
    completed: boolean;
  } | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "settled" | "mine">(
    "all",
  );

  const program = useMemo(
    () =>
      wallet
        ? getAccountabilityProgram(connection, wallet)
        : getReadOnlyAccountabilityProgram(connection),
    [connection, wallet],
  );

  const refreshPots = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoadingPots(true);
      try {
        const [programAccount, accounts] = await Promise.all([
          connection.getAccountInfo(program.programId, "confirmed"),
          program.account.pot.all(),
        ]);
        setProgramReady(Boolean(programAccount?.executable));
        setLoadError(null);
        setPots(
          accounts
            .map(({ publicKey, account }) => ({ ...account, publicKey }))
            .sort((left, right) =>
              Number(asBigInt(right.createdAt) - asBigInt(left.createdAt)),
            ),
        );
      } catch (fetchError) {
        setLoadError(actionError(fetchError));
      } finally {
        if (showLoading) setLoadingPots(false);
      }
    },
    [connection, program],
  );

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
    const initial = window.setTimeout(() => void refreshPots(), 0);
    const interval = window.setInterval(() => void refreshPots(false), 8_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshPots(false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshPots]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshBalance(), 0);
    const interval = window.setInterval(() => void refreshBalance(), 8_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshBalance();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBalance]);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const initial = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [address]);

  const afterTransaction = useCallback(
    async (message: string, transactionSignature?: string) => {
      setNotice(message);
      setSignature(transactionSignature ?? null);
      await Promise.all([refreshPots(), refreshBalance()]);
    },
    [refreshBalance, refreshPots],
  );

  async function connect() {
    setError(null);
    setNotice(null);
    setPending("connect");
    try {
      await onConnect();
    } catch (connectError) {
      setError(actionError(connectError));
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    if (!onDisconnect) return;
    setPending("disconnect");
    setError(null);
    try {
      await onDisconnect();
      setNotice(null);
      setSignature(null);
      setBalance(null);
      setSettlement(null);
      setFilter("all");
    } catch (disconnectError) {
      setError(actionError(disconnectError));
    } finally {
      setPending(null);
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setNotice("Wallet address copied.");
    } catch {
      // Clipboard access requires HTTPS on LAN origins. Keep the address copyable.
      setNotice(`Wallet address: ${address}`);
    }
    setSignature(null);
  }

  async function requestFunds() {
    if (!onRequestFunds) return;
    setError(null);
    setNotice(null);
    setPending("fund");
    try {
      const message = await onRequestFunds();
      await afterTransaction(message);
    } catch (fundError) {
      setError(actionError(fundError));
    } finally {
      setPending(null);
    }
  }

  async function createPot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet) return connect();
    setError(null);
    setNotice(null);
    try {
      const stakeLamports = parseSol(stake);
      const deadlineSeconds = Math.floor(new Date(deadline).getTime() / 1000);
      if (!task.trim()) throw new Error("Add a task description.");
      if (new TextEncoder().encode(task.trim()).length > 160) {
        throw new Error("Task descriptions are limited to 160 UTF-8 bytes.");
      }
      if (
        !Number.isFinite(deadlineSeconds) ||
        deadlineSeconds <= Math.floor(Date.now() / 1000)
      ) {
        throw new Error("Choose a future deadline.");
      }
      let judgeKey: PublicKey;
      try {
        judgeKey = new PublicKey(judge.trim() || wallet.publicKey);
        if (!PublicKey.isOnCurve(judgeKey.toBytes())) throw new Error();
      } catch {
        throw new Error(
          "Enter a valid judge wallet address, or leave it blank to judge this pot yourself.",
        );
      }
      const identifier = new BN(Date.now().toString());
      const [pot] = PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode("pot"),
          wallet.publicKey.toBytes(),
          identifierSeed(identifier),
        ],
        program.programId,
      );
      setPending("create");
      const txSignature = await program.methods
        .createPot(
          identifier,
          task.trim(),
          new BN(stakeLamports.toString()),
          new BN(deadlineSeconds),
          judgeKey,
        )
        .accountsPartial({
          creator: wallet.publicKey,
          pot,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTask("");
      setFilter("all");
      await afterTransaction(
        "Pot created. Choose YES or NO below to add your stake.",
        txSignature,
      );
    } catch (createError) {
      setError(actionError(createError));
    } finally {
      setPending(null);
    }
  }

  async function joinPot(pot: Pot, side: "yes" | "no") {
    if (!wallet) return connect();
    setError(null);
    setNotice(null);
    try {
      const stakeLamports = asBigInt(pot.stake);
      if (balance !== null && BigInt(balance) < stakeLamports + 10_000n) {
        throw new Error("Insufficient SOL for this stake and its network fee.");
      }
      setPending(`join-${pot.publicKey.toBase58()}-${side}`);
      const txSignature = await program.methods
        .joinPot(side === "yes" ? { yes: {} } : { no: {} })
        .accountsPartial({
          participant: wallet.publicKey,
          pot: pot.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await afterTransaction(
        `Joined ${side.toUpperCase()}. ${formatSol(pot.stake)} SOL moved from your wallet into the pot.`,
        txSignature,
      );
    } catch (joinError) {
      setError(actionError(joinError));
    } finally {
      setPending(null);
    }
  }

  async function settlePot(pot: Pot, completed: boolean) {
    if (!wallet) return connect();
    setError(null);
    setNotice(null);
    try {
      const winners = completed ? pot.yesParticipants : pot.noParticipants;
      const recipients =
        winners.length > 0
          ? winners
          : [...pot.yesParticipants, ...pot.noParticipants];
      setPending(`settle-${pot.publicKey.toBase58()}`);
      const txSignature = await program.methods
        .settlePot(completed)
        .accounts({ judge: wallet.publicKey, pot: pot.publicKey })
        .remainingAccounts(
          recipients.map((pubkey) => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
        )
        .rpc();
      const outcome = completed ? "Completed" : "Not completed";
      const payout =
        recipients.length === 0
          ? "The empty pot is closed."
          : winners.length === 0
            ? "No one chose this side, so every participant received a refund."
            : `${winners.length} ${winners.length === 1 ? "winner has" : "winners have"} been paid.`;
      await afterTransaction(`${outcome}. ${payout}`, txSignature);
      setSettlement(null);
    } catch (settleError) {
      setError(actionError(settleError));
    } finally {
      setPending(null);
    }
  }

  const visiblePots = pots.filter((pot) => {
    if (filter === "active") return !pot.settled;
    if (filter === "settled") return pot.settled;
    if (filter === "mine")
      return (
        address === pot.creator.toBase58() ||
        address === pot.judge.toBase58() ||
        [...pot.yesParticipants, ...pot.noParticipants].some(
          (person) => person.toBase58() === address,
        )
      );
    return true;
  });

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
                {balance === null
                  ? "Balance unavailable"
                  : `${formatSol(balance)} SOL`}
              </span>
              <button
                className="wallet-address text-button"
                type="button"
                title={`Copy wallet address: ${address}`}
                onClick={() => void copyAddress()}
              >
                {shorten(address)}
              </button>
              {onRequestFunds ? (
                <button
                  className="text-button"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void requestFunds()}
                >
                  {pending === "fund" ? "Adding test SOL…" : "Add test SOL"}
                </button>
              ) : null}
              {onDisconnect ? (
                <button
                  className="text-button"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void disconnect()}
                >
                  {pending === "disconnect" ? "Signing out…" : "Sign out"}
                </button>
              ) : null}
            </>
          ) : (
            <div className="connect-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={pending !== null}
                onClick={() => void connect()}
              >
                {pending === "connect" ? "Starting…" : connectLabel}
              </button>
              {secondaryConnect ? (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pending !== null}
                  onClick={secondaryConnect.onClick}
                >
                  {secondaryConnect.label}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </header>

      <section className="page-heading" id="top">
        <p className="overline">
          Accountability stakes · Solana{" "}
          {SOLANA_NETWORK === "localnet" ? "local rehearsal" : SOLANA_NETWORK}
        </p>
        <h1>Commit in public. Settle in full.</h1>
        <p>
          Stake test SOL on a commitment. A named judge decides the outcome when
          time is up.
        </p>
      </section>

      <ol className="how-it-works" aria-label="How Solara works">
        <li>
          <span>01</span>
          <div>
            <strong>Set a commitment</strong>
            <p>Choose a task, a deadline, and a judge.</p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Take a side</strong>
            <p>YES means completed. NO means not completed.</p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Settle the pot</strong>
            <p>The judge decides. Winners split the test SOL.</p>
          </div>
        </li>
      </ol>

      {notice ? (
        <div className="message message-success" role="status">
          <div>
            {notice}
            {signature ? (
              <a
                className="transaction-link"
                href={explorerUrl("tx", signature)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            ) : null}
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss update"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="message message-error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="workspace">
        <section className="create-column" aria-labelledby="create-heading">
          <div className="section-heading">
            <p className="overline">New pot</p>
            <h2 id="create-heading">Define the commitment</h2>
          </div>
          <form className="create-form" onSubmit={createPot} noValidate>
            <label>
              Task
              <textarea
                value={task}
                onChange={(event) => setTask(event.target.value)}
                maxLength={160}
                placeholder="Finish the pitch before our demo"
                aria-describedby="task-note"
              />
              <span
                className={`field-note ${new TextEncoder().encode(task.trim()).length > 160 ? "field-error" : ""}`}
                id="task-note"
              >
                {new TextEncoder().encode(task.trim()).length}/160 bytes · Keep
                the outcome easy to judge.
              </span>
            </label>
            <div className="form-grid">
              <label>
                Stake (SOL)
                <input
                  value={stake}
                  onChange={(event) => setStake(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.01"
                />
              </label>
              <label>
                Deadline
                <input
                  type="datetime-local"
                  step="1"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </label>
            </div>
            <div className="deadline-presets" aria-label="Quick deadlines">
              <span>From now</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setDeadline(deadlineFromNow(2))}
              >
                2 minutes
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setDeadline(deadlineFromNow(5))}
              >
                5 minutes
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setDeadline(deadlineFromNow(60))}
              >
                1 hour
              </button>
            </div>
            <label>
              Judge wallet
              <input
                value={judge}
                onChange={(event) => setJudge(event.target.value)}
                placeholder="Leave blank to judge it yourself"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="field-note">
                Choose someone your group trusts. Only this wallet can settle.
              </span>
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={
                pending !== null ||
                (wallet !== undefined && programReady !== true)
              }
            >
              {pending === "create"
                ? "Creating pot…"
                : wallet
                  ? "Create pot"
                  : "Connect to create"}
            </button>
            <p className="form-note">
              Creating pays account rent and a small network fee. You choose a
              side and add your stake separately.
            </p>
          </form>
        </section>

        <section className="pots-column" aria-labelledby="pots-heading">
          <div className="pots-header">
            <div className="section-heading">
              <p className="overline">Open record</p>
              <h2 id="pots-heading">Pots</h2>
            </div>
            <button
              className="text-button"
              type="button"
              disabled={loadingPots}
              onClick={() =>
                void Promise.all([refreshPots(), refreshBalance()])
              }
            >
              {loadingPots ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {pots.length > 0 ? (
            <div className="pot-filters" aria-label="Filter pots">
              <button
                className="filter-button"
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All ({pots.length})
              </button>
              <button
                className="filter-button"
                type="button"
                aria-pressed={filter === "active"}
                onClick={() => setFilter("active")}
              >
                Active ({pots.filter((pot) => !pot.settled).length})
              </button>
              <button
                className="filter-button"
                type="button"
                aria-pressed={filter === "settled"}
                onClick={() => setFilter("settled")}
              >
                Settled ({pots.filter((pot) => pot.settled).length})
              </button>
              {address ? (
                <button
                  className="filter-button"
                  type="button"
                  aria-pressed={filter === "mine"}
                  onClick={() => setFilter("mine")}
                >
                  My pots
                </button>
              ) : null}
            </div>
          ) : null}
          {loadError ? (
            <div className="message message-error" role="alert">
              {loadError}
            </div>
          ) : null}
          {programReady === false ? (
            <div className="empty-state">
              <h3>Getting {SOLANA_NETWORK} ready</h3>
              <p>
                The host still needs to deploy the program. You can connect your
                wallet now; pots will appear here when setup is complete.
              </p>
            </div>
          ) : null}
          {loadingPots ? (
            <p className="empty-copy">Loading pots from {SOLANA_NETWORK}…</p>
          ) : null}
          {!loadingPots && !loadError && programReady && pots.length === 0 ? (
            <div className="empty-state">
              <h3>No pots yet</h3>
              <p>
                Create the first commitment, then share the page for others to
                take a side.
              </p>
            </div>
          ) : null}
          {!loadingPots && pots.length > 0 && visiblePots.length === 0 ? (
            <div className="empty-state">
              <h3>
                No{" "}
                {filter === "mine" ? "pots for this wallet" : `${filter} pots`}{" "}
                yet
              </h3>
              <p>
                {filter === "mine"
                  ? "Create a pot, take a side, or be named as a judge to see it here."
                  : "Choose All to see the other pots."}
              </p>
            </div>
          ) : null}
          <div className="pot-list">
            {visiblePots.map((pot) => {
              const joinedYes = address
                ? pot.yesParticipants.some(
                    (person) => person.toBase58() === address,
                  )
                : false;
              const joinedNo = address
                ? pot.noParticipants.some(
                    (person) => person.toBase58() === address,
                  )
                : false;
              const joined = joinedYes || joinedNo;
              const deadlinePassed =
                Number(asBigInt(pot.deadline)) <= Math.floor(now / 1000);
              const isJudge = address === pot.judge.toBase58();
              const participantCount =
                pot.yesParticipants.length + pot.noParticipants.length;
              const settlementPending =
                pending === `settle-${pot.publicKey.toBase58()}`;
              const pool = asBigInt(pot.stake) * BigInt(participantCount);
              const winners = pot.outcome
                ? pot.yesParticipants
                : pot.noParticipants;
              const refunded =
                pot.settled && participantCount > 0 && winners.length === 0;
              const won = pot.settled && (pot.outcome ? joinedYes : joinedNo);
              const confirming =
                !pot.settled &&
                settlement?.pot === pot.publicKey.toBase58() &&
                isJudge;
              const selectedWinners = settlement?.completed
                ? pot.yesParticipants
                : pot.noParticipants;
              return (
                <article
                  className={`pot-row ${pot.settled ? "pot-settled" : ""}`}
                  key={pot.publicKey.toBase58()}
                  id={`pot-${pot.publicKey.toBase58()}`}
                >
                  <div className="pot-main">
                    <div className="pot-title-line">
                      <h3>{pot.task}</h3>
                      <span
                        className={
                          pot.settled ? "status status-settled" : "status"
                        }
                      >
                        {pot.settled
                          ? pot.outcome
                            ? "Completed"
                            : "Not completed"
                          : deadlinePassed
                            ? "Awaiting judge"
                            : participantCount === 10
                              ? "Full"
                              : "Open"}
                      </span>
                    </div>
                    <dl className="pot-details">
                      <div>
                        <dt>Stake</dt>
                        <dd>{formatSol(pot.stake)} SOL</dd>
                      </div>
                      <div>
                        <dt>Staked pool</dt>
                        <dd>{formatSol(pool)} SOL</dd>
                      </div>
                      <div>
                        <dt>Deadline</dt>
                        <dd
                          title={new Date(
                            Number(asBigInt(pot.deadline)) * 1000,
                          ).toLocaleString()}
                        >
                          {formatDeadline(pot.deadline)}
                        </dd>
                      </div>
                      <div>
                        <dt>Judge</dt>
                        <dd title={pot.judge.toBase58()}>
                          {isJudge ? "You" : shorten(pot.judge.toBase58())}
                        </dd>
                      </div>
                    </dl>
                    <div className="pot-sides">
                      <span>
                        <strong>YES {pot.yesParticipants.length}</strong> ·
                        completed
                      </span>
                      <span>
                        <strong>NO {pot.noParticipants.length}</strong> · not
                        completed
                      </span>
                    </div>
                    {!pot.settled ? (
                      <p className="time-note">
                        {timeRemaining(pot.deadline, now)} · {participantCount}
                        /10 places filled
                      </p>
                    ) : (
                      <p className="time-note">
                        {participantCount === 0
                          ? "Empty pot settled. No SOL to distribute."
                          : refunded
                            ? `All ${participantCount} ${participantCount === 1 ? "participant was" : "participants were"} refunded because no one chose the winning side.`
                            : `Pool paid to ${winners.length} ${pot.outcome ? "YES" : "NO"} ${winners.length === 1 ? "participant" : "participants"}.`}
                      </p>
                    )}
                    {joined ? (
                      <p
                        className={`your-result ${pot.settled ? "result-settled" : ""}`}
                      >
                        {pot.settled
                          ? refunded
                            ? `Your ${formatSol(pot.stake)} SOL stake was refunded.`
                            : won
                              ? `Your ${joinedYes ? "YES" : "NO"} side won. Your payout is in your wallet.`
                              : `You chose ${joinedYes ? "YES" : "NO"}. Your stake went to the winning side.`
                          : `You staked ${formatSol(pot.stake)} SOL on ${joinedYes ? "YES" : "NO"}.`}
                      </p>
                    ) : null}
                  </div>
                  {!pot.settled && !deadlinePassed && !joined ? (
                    <div className="pot-actions">
                      <span className="side-count">
                        {participantCount === 10
                          ? "All 10 places are taken."
                          : `Choose a side · ${formatSol(pot.stake)} SOL`}
                      </span>
                      <div className="button-group">
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={pending !== null || participantCount >= 10}
                          onClick={() => void joinPot(pot, "yes")}
                        >
                          {pending === `join-${pot.publicKey.toBase58()}-yes`
                            ? "Joining…"
                            : "Join YES"}
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={pending !== null || participantCount >= 10}
                          onClick={() => void joinPot(pot, "no")}
                        >
                          {pending === `join-${pot.publicKey.toBase58()}-no`
                            ? "Joining…"
                            : "Join NO"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {!pot.settled && deadlinePassed && isJudge ? (
                    <div className="pot-actions settlement-actions">
                      <span className="side-count">
                        You are the judge. Was the task completed?
                      </span>
                      <div className="button-group">
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={pending !== null}
                          onClick={() =>
                            setSettlement({
                              pot: pot.publicKey.toBase58(),
                              completed: true,
                            })
                          }
                        >
                          Completed
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={pending !== null}
                          onClick={() =>
                            setSettlement({
                              pot: pot.publicKey.toBase58(),
                              completed: false,
                            })
                          }
                        >
                          Not completed
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {confirming ? (
                    <div
                      className="settlement-review"
                      role="region"
                      aria-label="Review settlement"
                    >
                      <h4>
                        Settle as{" "}
                        {settlement.completed ? "completed" : "not completed"}?
                      </h4>
                      <p>
                        {participantCount === 0
                          ? "This pot is empty. It will close without a payout."
                          : selectedWinners.length === 0
                            ? `No one chose ${settlement.completed ? "YES" : "NO"}. Every participant will receive their stake back.`
                            : `${selectedWinners.length} ${settlement.completed ? "YES" : "NO"} ${selectedWinners.length === 1 ? "participant will" : "participants will"} split the ${formatSol(pool)} SOL staked pool.`}{" "}
                        This decision is final.
                      </p>
                      <div className="button-group">
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={pending !== null}
                          onClick={() =>
                            void settlePot(pot, settlement.completed)
                          }
                        >
                          {settlementPending
                            ? "Settling…"
                            : "Confirm settlement"}
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={pending !== null}
                          onClick={() => setSettlement(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {!pot.settled && deadlinePassed && !isJudge ? (
                    <p className="waiting-note">
                      Joining is closed. Waiting for the named judge to settle.
                    </p>
                  ) : null}
                  <a
                    className="record-link"
                    href={explorerUrl("address", pot.publicKey.toBase58())}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on-chain record ↗
                  </a>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <footer className="app-footer">
        Uses {SOLANA_NETWORK} test SOL.{" "}
        {wallet
          ? `Connected with ${walletLabel}.`
          : "No wallet extension is required."}{" "}
        Pots and balances refresh every eight seconds.
      </footer>
    </main>
  );
}
