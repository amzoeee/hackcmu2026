"use client";

import { BN } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getAccountabilityProgram,
  getReadOnlyAccountabilityProgram,
  getReadOnlyConnection,
} from "@/lib/anchor/client";
import {
  DEVNET_GENESIS,
  IS_LOCALNET,
  SOLANA_NETWORK,
  SOLANA_RPC_URL,
} from "@/lib/solana";

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
// These mirror MAX_PARTICIPANTS and MAX_TASK_LENGTH in the Anchor program.
const MAX_PARTICIPANTS = 10;
const MAX_TASK_BYTES = 160;
// The program compares against the cluster Clock, which can trail wall time by
// a few slots. Hold joins open and settlement back until the chain has caught up.
const CLOCK_DRIFT_SECONDS = 10;

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
  const amount = asBigInt(lamports);
  const whole = amount / ONE_SOL;
  const remainder = amount % ONE_SOL;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 9,
  });
  const fraction = formatter
    .formatToParts(
      Number(remainder < 0n ? -remainder : remainder) / LAMPORTS_PER_SOL,
    )
    .filter(({ type }) => type === "decimal" || type === "fraction")
    .map(({ value }) => value)
    .join("");
  return `${formatter.format(amount < 0n && whole === 0n ? -0 : whole)}${fraction}`;
}

function parseSol(value: string) {
  if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(value.trim())) {
    throw new Error(
      "Enter a SOL amount using a decimal point and up to 9 decimal places.",
    );
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
  const date = new Date(Number(asBigInt(deadline)) * 1000);
  if (!Number.isFinite(date.getTime())) return "Beyond calendar range";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function timeRemaining(deadline: BN | bigint | number, now: number) {
  const seconds = Number(asBigInt(deadline)) - Math.floor(now / 1000);
  if (seconds <= 0) return "Deadline passed";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
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
    const message = error.message || error.toString();
    const programMessage = message.match(/Error Message: ([^\n]+)/)?.[1];
    if (programMessage) return programMessage.replace(/\.+$/, ".");
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
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /failed to fetch|fetch failed|network request|429|too many requests/i.test(
        message,
      )
    ) {
      return "The Solana connection is not responding right now. Your last loaded pots are still shown. Try refreshing in a moment.";
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
  const [walletBalance, setWalletBalance] = useState<{
    address: string;
    lamports: number;
  } | null>(null);
  const balance =
    walletBalance && walletBalance.address === address
      ? walletBalance.lamports
      : null;
  const potRequest = useRef(0);
  const balanceRequest = useRef(0);
  const potReadInFlight = useRef(false);
  const balanceReadInFlight = useRef(false);
  const lastLinkedPot = useRef<string | null>(null);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [stake, setStake] = useState("0.01");
  const [deadline, setDeadline] = useState("");
  const [judge, setJudge] = useState("");
  const [settlement, setSettlement] = useState<{
    pot: string;
    completed: boolean;
  } | null>(null);
  const settlementButton = useRef<HTMLButtonElement | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "settled" | "mine">(
    "all",
  );
  const [sharedPot, setSharedPot] = useState<{
    address: string;
    url: string;
    copied: boolean;
    local: boolean;
  } | null>(null);

  const program = useMemo(
    () =>
      wallet
        ? getAccountabilityProgram(connection, wallet)
        : getReadOnlyAccountabilityProgram(connection),
    [connection, wallet],
  );
  const readConnection = useMemo(
    () => getReadOnlyConnection(connection.rpcEndpoint),
    [connection],
  );
  const readProgram = useMemo(
    () => getReadOnlyAccountabilityProgram(readConnection),
    [readConnection],
  );

  useEffect(() => {
    if (error) errorMessage.current?.scrollIntoView({ block: "center" });
  }, [error]);

  useEffect(() => {
    const scrollToPot = () => {
      const id = window.location.hash.slice(1);
      if (!id.startsWith("pot-") || lastLinkedPot.current === id) return;
      const element = document.getElementById(id);
      if (!element) return;
      lastLinkedPot.current = id;
      element.scrollIntoView({ block: "start" });
      element.focus({ preventScroll: true });
    };
    const onHashChange = () => {
      lastLinkedPot.current = null;
      if (window.location.hash.startsWith("#pot-")) setFilter("all");
      scrollToPot();
    };
    scrollToPot();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pots, filter]);

  const refreshPots = useCallback(
    async (showLoading = true) => {
      if (!showLoading && potReadInFlight.current) return;
      const request = ++potRequest.current;
      potReadInFlight.current = true;
      if (showLoading) setLoadingPots(true);
      try {
        if (SOLANA_NETWORK !== "devnet" && !IS_LOCALNET) {
          setProgramReady(null);
          throw new Error(
            "Use Solana devnet or the local rehearsal to open this prototype.",
          );
        }
        const [programAccount, accounts, genesis] = await Promise.all([
          readConnection.getAccountInfo(readProgram.programId, "confirmed"),
          readProgram.account.pot.all(),
          SOLANA_NETWORK === "devnet"
            ? readConnection.getGenesisHash()
            : Promise.resolve(null),
        ]);
        if (request !== potRequest.current) return;
        if (SOLANA_NETWORK === "devnet" && genesis !== DEVNET_GENESIS) {
          setProgramReady(null);
          setPots([]);
          throw new Error(
            "The configured connection is not Solana devnet. Ask the host to correct the RPC setting.",
          );
        }
        setProgramReady(Boolean(programAccount?.executable));
        setLoadError(null);
        setPots(
          accounts
            .map(({ publicKey, account }) => ({ ...account, publicKey }))
            .sort(
              (left, right) =>
                Number(asBigInt(right.createdAt) - asBigInt(left.createdAt)) ||
                Number(asBigInt(right.identifier) - asBigInt(left.identifier)),
            ),
        );
      } catch (fetchError) {
        if (request === potRequest.current)
          setLoadError(actionError(fetchError));
      } finally {
        if (request === potRequest.current) {
          potReadInFlight.current = false;
          setLoadingPots(false);
        }
      }
    },
    [readConnection, readProgram],
  );

  const refreshBalance = useCallback(
    async (force = false) => {
      if (!force && balanceReadInFlight.current) return;
      const request = ++balanceRequest.current;
      if (!wallet) {
        setWalletBalance(null);
        return;
      }
      balanceReadInFlight.current = true;
      try {
        const lamports = await readConnection.getBalance(
          wallet.publicKey,
          "confirmed",
        );
        if (request === balanceRequest.current)
          setWalletBalance({ address: wallet.publicKey.toBase58(), lamports });
      } catch {
        if (request === balanceRequest.current) setWalletBalance(null);
      } finally {
        if (request === balanceRequest.current)
          balanceReadInFlight.current = false;
      }
    },
    [readConnection, wallet],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshPots(), 0);
    const interval = window.setInterval(() => void refreshPots(false), 8_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshPots(false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      potRequest.current += 1;
      potReadInFlight.current = false;
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
      balanceRequest.current += 1;
      balanceReadInFlight.current = false;
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
  }, []);

  const afterTransaction = useCallback(
    (message: string, transactionSignature?: string) => {
      setNotice(message);
      setSignature(transactionSignature ?? null);
      void refreshPots();
      void refreshBalance(true);
    },
    [refreshBalance, refreshPots],
  );

  function showTransactionError(transactionError: unknown) {
    if (
      transactionError instanceof Error &&
      "signature" in transactionError &&
      typeof transactionError.signature === "string"
    ) {
      setSignature(transactionError.signature);
    }
    setError(actionError(transactionError));
  }

  async function connect() {
    setError(null);
    setNotice(null);
    setSignature(null);
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
      setWalletBalance(null);
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
    setSignature(null);
    try {
      await navigator.clipboard.writeText(address);
      setNotice("Wallet address copied.");
    } catch {
      // Clipboard access requires HTTPS on LAN origins. Keep the address copyable.
      setNotice(`Wallet address: ${address}`);
    }
  }

  async function sharePot(pot: Pot) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `pot-${pot.publicKey.toBase58()}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url.toString());
      copied = true;
    } catch {
      // LAN pages may not have clipboard access; the inline field is copyable.
    }
    setSharedPot({
      address: pot.publicKey.toBase58(),
      url: url.toString(),
      copied,
      local: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    });
  }

  async function requestFunds() {
    if (!onRequestFunds) return;
    setError(null);
    setNotice(null);
    setSignature(null);
    setPending("fund");
    try {
      const message = await onRequestFunds();
      afterTransaction(message);
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
    setSignature(null);
    try {
      const stakeLamports = parseSol(stake);
      const deadlineSeconds = Math.floor(new Date(deadline).getTime() / 1000);
      if (!task.trim()) throw new Error("Add a task description.");
      if (taskBytes > MAX_TASK_BYTES) {
        throw new Error(
          `Task descriptions are limited to ${MAX_TASK_BYTES} UTF-8 bytes.`,
        );
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
      afterTransaction(
        "Pot created. Choose YES or NO below to add your stake.",
        txSignature,
      );
    } catch (createError) {
      showTransactionError(createError);
    } finally {
      setPending(null);
    }
  }

  async function joinPot(pot: Pot, side: "yes" | "no") {
    if (!wallet) return connect();
    setError(null);
    setNotice(null);
    setSignature(null);
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
      afterTransaction(
        `Joined ${side.toUpperCase()}. ${formatSol(pot.stake)} SOL moved from your wallet into the pot.`,
        txSignature,
      );
    } catch (joinError) {
      showTransactionError(joinError);
    } finally {
      setPending(null);
    }
  }

  async function settlePot(pot: Pot, completed: boolean) {
    if (!wallet) return connect();
    setError(null);
    setNotice(null);
    setSignature(null);
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
          ? "The empty pot is settled."
          : winners.length === 0
            ? "No one chose this side, so every participant received a refund."
            : `${winners.length} ${winners.length === 1 ? "winner has" : "winners have"} been paid.`;
      afterTransaction(`${outcome}. ${payout}`, txSignature);
      setSettlement(null);
    } catch (settleError) {
      showTransactionError(settleError);
    } finally {
      setPending(null);
    }
  }

  const taskBytes = new TextEncoder().encode(task.trim()).length;

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
                aria-label="Copy wallet address"
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

      {notice || signature ? (
        <div
          className={notice ? "message message-success" : "message"}
          role="status"
        >
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
            onClick={() => {
              setNotice(null);
              setSignature(null);
            }}
            aria-label="Dismiss update"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="message message-error" role="alert" ref={errorMessage}>
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
                disabled={pending === "create"}
                value={task}
                onChange={(event) => setTask(event.target.value)}
                maxLength={MAX_TASK_BYTES}
                placeholder="Finish the pitch before our demo"
                aria-describedby="task-note"
              />
              <span
                className={`field-note ${taskBytes > MAX_TASK_BYTES ? "field-error" : ""}`}
                id="task-note"
              >
                {taskBytes}/{MAX_TASK_BYTES} bytes · Keep the outcome easy to
                judge.
              </span>
            </label>
            <div className="form-grid">
              <label>
                Stake (SOL)
                <input
                  disabled={pending === "create"}
                  value={stake}
                  onChange={(event) => setStake(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.01"
                />
              </label>
              <label>
                Deadline
                <input
                  disabled={pending === "create"}
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
                disabled={pending === "create"}
                onClick={() => setDeadline(deadlineFromNow(2))}
              >
                2 minutes
              </button>
              <button
                type="button"
                className="text-button"
                disabled={pending === "create"}
                onClick={() => setDeadline(deadlineFromNow(5))}
              >
                5 minutes
              </button>
              <button
                type="button"
                className="text-button"
                disabled={pending === "create"}
                onClick={() => setDeadline(deadlineFromNow(60))}
              >
                1 hour
              </button>
            </div>
            <label>
              Judge wallet
              <input
                disabled={pending === "create"}
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
            <details className="pot-rules">
              <summary>Staking and payout rules</summary>
              <p>
                Each wallet can join one side once, before the deadline. All
                participants stake the same amount, with at most 10 people per
                pot.
              </p>
              <p>
                Only the named judge can settle after the deadline. Winners
                split the pool equally. If no one chose the winning side,
                everyone gets their stake back. Network fees and account rent
                are separate from the pool.
              </p>
            </details>
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
                void Promise.all([refreshPots(), refreshBalance(true)])
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
                Number(asBigInt(pot.deadline)) + CLOCK_DRIFT_SECONDS <=
                Math.floor(now / 1000);
              const isJudge = address === pot.judge.toBase58();
              const participantCount =
                pot.yesParticipants.length + pot.noParticipants.length;
              const settlementPending =
                pending === `settle-${pot.publicKey.toBase58()}`;
              const pool = asBigInt(pot.stake) * BigInt(participantCount);
              const winners = pot.outcome
                ? pot.yesParticipants
                : pot.noParticipants;
              const winnerPayout = winners.length
                ? pool / BigInt(winners.length)
                : 0n;
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
              const reviewRecipients =
                selectedWinners.length || participantCount;
              const reviewPayout = reviewRecipients
                ? pool / BigInt(reviewRecipients)
                : 0n;
              return (
                <article
                  className={`pot-row ${pot.settled ? "pot-settled" : ""}`}
                  key={pot.publicKey.toBase58()}
                  id={`pot-${pot.publicKey.toBase58()}`}
                  tabIndex={-1}
                  aria-label={pot.task}
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
                            : participantCount === MAX_PARTICIPANTS
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
                        {timeRemaining(pot.deadline, now)} · {participantCount}/
                        {MAX_PARTICIPANTS} places filled
                      </p>
                    ) : (
                      <p className="time-note">
                        {participantCount === 0
                          ? "Empty pot settled. No SOL to distribute."
                          : refunded
                            ? `${participantCount === 1 ? "The only participant was" : `All ${participantCount} participants were`} refunded because no one chose the winning side.`
                            : `Pool paid to ${winners.length} ${pot.outcome ? "YES" : "NO"} ${winners.length === 1 ? "participant" : "participants"}.`}
                      </p>
                    )}
                    {joined ? (
                      <p
                        className={`your-result ${pot.settled ? "result-settled" : ""}`}
                        role="status"
                      >
                        {pot.settled
                          ? refunded
                            ? `Your ${formatSol(pot.stake)} SOL stake was refunded.`
                            : won
                              ? `Your ${joinedYes ? "YES" : "NO"} side won. Your share of the staked pool was ${formatSol(winnerPayout)} SOL, including your stake.`
                              : `You chose ${joinedYes ? "YES" : "NO"}. Your stake went to the winning side.`
                          : `You staked ${formatSol(pot.stake)} SOL on ${joinedYes ? "YES" : "NO"}.`}
                      </p>
                    ) : null}
                  </div>
                  {!pot.settled && !deadlinePassed && !joined ? (
                    <div className="pot-actions">
                      <span className="side-count">
                        {participantCount === MAX_PARTICIPANTS
                          ? `All ${MAX_PARTICIPANTS} places are taken.`
                          : `Choose a side · ${formatSol(pot.stake)} SOL`}
                      </span>
                      <div className="button-group">
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={
                            pending !== null ||
                            participantCount >= MAX_PARTICIPANTS ||
                            programReady !== true
                          }
                          onClick={() => void joinPot(pot, "yes")}
                        >
                          {pending === `join-${pot.publicKey.toBase58()}-yes`
                            ? "Joining…"
                            : "Join YES"}
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={
                            pending !== null ||
                            participantCount >= MAX_PARTICIPANTS ||
                            programReady !== true
                          }
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
                          disabled={pending !== null || programReady !== true}
                          onClick={(event) => {
                            settlementButton.current = event.currentTarget;
                            setSettlement({
                              pot: pot.publicKey.toBase58(),
                              completed: true,
                            });
                          }}
                        >
                          Completed
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={pending !== null || programReady !== true}
                          onClick={(event) => {
                            settlementButton.current = event.currentTarget;
                            setSettlement({
                              pot: pot.publicKey.toBase58(),
                              completed: false,
                            });
                          }}
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
                          ? "This pot is empty. It will settle without a payout."
                          : selectedWinners.length === 0
                            ? `No one chose ${settlement.completed ? "YES" : "NO"}. Each participant will receive ${formatSol(reviewPayout)} SOL from the staked pool, refunding their original stake.`
                            : selectedWinners.length === 1
                              ? `The ${settlement.completed ? "YES" : "NO"} participant will receive ${formatSol(reviewPayout)} SOL from the staked pool, including their original stake.`
                              : `Each of the ${selectedWinners.length} ${settlement.completed ? "YES" : "NO"} participants will receive ${formatSol(reviewPayout)} SOL from the staked pool, including their original stake.`}{" "}
                        This decision is final.
                      </p>
                      <div className="button-group">
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={pending !== null || programReady !== true}
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
                          onClick={() => {
                            setSettlement(null);
                            settlementButton.current?.focus();
                          }}
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
                  <details className="participants">
                    <summary>Participants ({participantCount})</summary>
                    {participantCount === 0 ? (
                      <p>No one has staked yet.</p>
                    ) : (
                      <ul>
                        {[
                          ...pot.yesParticipants.map((person) => ({
                            person,
                            side: "YES",
                          })),
                          ...pot.noParticipants.map((person) => ({
                            person,
                            side: "NO",
                          })),
                        ].map(({ person, side }) => (
                          <li key={person.toBase58()}>
                            <strong>{side}</strong>
                            <a
                              href={explorerUrl("address", person.toBase58())}
                              target="_blank"
                              rel="noreferrer"
                              title={person.toBase58()}
                            >
                              {person.toBase58()}
                              {person.toBase58() === address ? " (you)" : ""}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                  <div className="pot-records">
                    <a
                      className="record-link"
                      href={explorerUrl("address", pot.publicKey.toBase58())}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on-chain record ↗
                    </a>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void sharePot(pot)}
                    >
                      Share pot
                    </button>
                  </div>
                  {sharedPot?.address === pot.publicKey.toBase58() ? (
                    <div className="share-link">
                      <label>
                        Pot link
                        <input
                          type="url"
                          readOnly
                          value={sharedPot.url}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      </label>
                      <p>
                        {sharedPot.copied
                          ? "Copied to your clipboard."
                          : "Select and copy this link."}{" "}
                        {IS_LOCALNET
                          ? "Open this local rehearsal in another browser profile on this computer."
                          : sharedPot.local
                            ? "Open it in another browser profile on this computer. For other devices, open the host's LAN address before sharing."
                            : "Anyone with this link can view the pot."}
                      </p>
                    </div>
                  ) : null}
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
