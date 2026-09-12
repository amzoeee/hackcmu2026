"use client";

import { BN, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
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

import {
  asBigInt,
  formatSol,
  parseSol,
  deadlineFromNow,
  deadlineEndOfDay,
  potAddress,
} from "@/lib/pot-values";

import { GroupChallengeForm } from "./group-challenge-form";
import { parseGroupTask } from "@/lib/group-challenge";

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

type FinanceYourResponsibilitiesAppProps = {
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

// These mirror MAX_PARTICIPANTS and MAX_TASK_LENGTH in the Anchor program.
const MAX_PARTICIPANTS = 10;
const MAX_TASK_BYTES = 160;
// Must match SETTLEMENT_GRACE_SECONDS in the program.
const SETTLEMENT_GRACE_SECONDS = 300;
// The program compares against the cluster Clock, which can trail wall time by
// a few slots. Hold joins open and settlement back until the chain has caught up.
const CLOCK_DRIFT_SECONDS = 10;

function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
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

function explorerUrl(kind: "tx" | "address", value: string) {
  const cluster =
    SOLANA_NETWORK === "localnet"
      ? `custom&customUrl=${encodeURIComponent(SOLANA_RPC_URL)}`
      : SOLANA_NETWORK;
  return `https://explorer.solana.com/${kind}/${value}?cluster=${cluster}`;
}

function timeRemaining(deadline: BN | bigint | number, now: number) {
  const seconds = Number(asBigInt(deadline)) - Math.floor(now / 1000);
  if (seconds <= 0) return "Deadline passed";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return minutes > 0 ? `${minutes}m ${seconds % 60}s left` : `${seconds}s left`;
}

function actionError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message || error.toString();
    const programMessage = message.match(/Error Message: ([^\n]+)/)?.[1];
    if (programMessage) return programMessage.replace(/\.+$/, ".");
    if (/User rejected|User denied|rejected the request/i.test(message)) {
      return "Cancelled in wallet. Nothing was sent.";
    }
    if (
      /insufficient (funds|lamports)|no record of a prior credit/i.test(message)
    ) {
      return "Not enough SOL for this action and its fee.";
    }
    if (/blockhash not found|block height exceeded|expired/i.test(message)) {
      return "Transaction expired. Refresh before retrying.";
    }
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /failed to fetch|fetch failed|network request|429|too many requests/i.test(
        message,
      )
    ) {
      return "Solana RPC is not responding. Try again shortly.";
    }
    return message.replace(/^Error: /, "").slice(0, 300);
  }
  return "Transaction failed. Try again.";
}

export function FinanceYourResponsibilitiesApp({
  connection,
  wallet,
  address,
  onConnect,
  onDisconnect,
  onRequestFunds,
  secondaryConnect,
  connectLabel,
  walletLabel,
}: FinanceYourResponsibilitiesAppProps) {
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
  // The published IDL only changes on deploy, so verify it once per connection.
  const recoveryIdlVerified = useRef<boolean | null>(null);
  const lastLinkedPot = useRef<string | null>(null);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"single" | "group">("single");
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
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
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
    const loadGroup = () =>
      setGroupFilter(new URLSearchParams(window.location.search).get("group"));
    const initial = window.setTimeout(loadGroup, 0);
    window.addEventListener("popstate", loadGroup);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("popstate", loadGroup);
    };
  }, []);

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
      if (window.location.hash.startsWith("#pot-")) {
        setFilter("all");
        setGroupFilter(null);
      }
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
          throw new Error("Unsupported network. Use devnet or localnet.");
        }
        const [programAccount, accounts, genesis, deployedIdl] =
          await Promise.all([
            readConnection.getAccountInfo(readProgram.programId, "confirmed"),
            readProgram.account.pot.all(),
            SOLANA_NETWORK === "devnet"
              ? readConnection.getGenesisHash()
              : Promise.resolve(null),
            SOLANA_NETWORK === "devnet" && recoveryIdlVerified.current !== true
              ? // A failed IDL read must not discard pots that loaded correctly.
                Program.fetchIdl(
                  readProgram.programId,
                  readProgram.provider,
                ).catch(() => undefined)
              : Promise.resolve(undefined),
          ]);
        if (request !== potRequest.current) return;
        if (SOLANA_NETWORK === "devnet" && genesis !== DEVNET_GENESIS) {
          setProgramReady(null);
          setPots([]);
          throw new Error("The configured RPC is not Solana devnet.");
        }
        if (SOLANA_NETWORK === "devnet" && deployedIdl !== undefined) {
          // null means the IDL account is absent; undefined means the read failed.
          recoveryIdlVerified.current = Boolean(
            deployedIdl?.instructions.some(
              (instruction) => instruction.name === "refund_pot",
            ) &&
            deployedIdl.constants?.some(
              (constant) =>
                constant.name === "SETTLEMENT_GRACE_SECONDS" &&
                Number(constant.value) === SETTLEMENT_GRACE_SECONDS,
            ),
          );
        }
        const compatible = IS_LOCALNET || recoveryIdlVerified.current === true;
        setProgramReady(Boolean(programAccount?.executable) && compatible);
        setLoadError(
          programAccount?.executable && recoveryIdlVerified.current === false
            ? "Deployed program is outdated. Redeploy the current program and IDL."
            : null,
        );
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
    recoveryIdlVerified.current = null;
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

  async function copyWalletAddress(walletAddress: string, label: string) {
    setSignature(null);
    try {
      await navigator.clipboard.writeText(walletAddress);
      setNotice(`${label} address copied.`);
    } catch {
      // Clipboard access requires HTTPS on LAN origins. Keep the address copyable.
      setNotice(`${label} address: ${walletAddress}`);
    }
  }

  async function copyAddress() {
    if (!address) return;
    await copyWalletAddress(address, "Wallet");
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
      if (!task.trim()) throw new Error("Enter a task.");
      if (taskBytes > MAX_TASK_BYTES) {
        throw new Error(`Task is over ${MAX_TASK_BYTES} bytes.`);
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
        throw new Error("Invalid judge address.");
      }
      const identifier = new BN(Date.now().toString());
      const pot = potAddress(wallet.publicKey, identifier, program.programId);
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
      afterTransaction("Pot created. Join a side to stake.", txSignature);
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
        throw new Error("Not enough SOL for this stake and its fee.");
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
        `Joined ${side.toUpperCase()} · ${formatSol(pot.stake)} SOL staked.`,
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
      const everyone = [...pot.yesParticipants, ...pot.noParticipants];
      const unopposed =
        !pot.yesParticipants.length || !pot.noParticipants.length;
      const recipients =
        everyone.length === 0
          ? []
          : unopposed
            ? completed
              ? everyone
              : [pot.judge]
            : winners;
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
          ? "No payout."
          : unopposed
            ? completed
              ? "Stakes refunded."
              : "Pool sent to the judge."
            : `${winners.length} ${winners.length === 1 ? "winner" : "winners"} paid.`;
      afterTransaction(`${outcome}. ${payout}`, txSignature);
      setSettlement(null);
    } catch (settleError) {
      showTransactionError(settleError);
    } finally {
      setPending(null);
    }
  }

  async function refundPot(pot: Pot) {
    if (!wallet) return connect();
    setError(null);
    setNotice(null);
    setSignature(null);
    setPending(`refund-${pot.publicKey.toBase58()}`);
    try {
      const txSignature = await program.methods
        .refundPot()
        .accounts({ caller: wallet.publicKey, pot: pot.publicKey })
        .remainingAccounts(
          [...pot.yesParticipants, ...pot.noParticipants].map((pubkey) => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
        )
        .rpc();
      setSettlement(null);
      afterTransaction("All stakes refunded.", txSignature);
    } catch (refundError) {
      showTransactionError(refundError);
    } finally {
      setPending(null);
    }
  }

  const taskBytes = new TextEncoder().encode(task.trim()).length;

  // Parsing decodes and re-encodes a base58 key, and the clock re-renders this
  // list every second, so parse each task once per loaded set of pots.
  const groupTags = useMemo(
    () =>
      new Map(
        pots.map((pot) => [pot.publicKey.toBase58(), parseGroupTask(pot.task)]),
      ),
    [pots],
  );

  const visiblePots = pots.filter((pot) => {
    const group = groupTags.get(pot.publicKey.toBase58());
    if (
      groupFilter &&
      `${pot.creator.toBase58()}:${group?.groupId}` !== groupFilter
    )
      return false;
    if (filter === "active") return !pot.settled;
    if (filter === "settled") return pot.settled;
    if (filter === "mine")
      return (
        address === group?.participant ||
        address === pot.creator.toBase58() ||
        address === pot.judge.toBase58() ||
        [...pot.yesParticipants, ...pot.noParticipants].some(
          (person) => person.toBase58() === address,
        )
      );
    return true;
  });

  const filters: {
    value: typeof filter;
    label: string;
    count: number | null;
  }[] = [
    { value: "all", label: "All", count: pots.length },
    {
      value: "active",
      label: "Active",
      count: pots.filter((pot) => !pot.settled).length,
    },
    {
      value: "settled",
      label: "Settled",
      count: pots.filter((pot) => pot.settled).length,
    },
    ...(address
      ? [{ value: "mine" as const, label: "Mine", count: null }]
      : []),
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              FYR
            </span>
            <h1 className="brand-name">Finance your Responsibilities</h1>
            <span className="tag tag-ink">{SOLANA_NETWORK}</span>
          </div>
          <div className="wallet-area">
            {address ? (
              <>
                <span className="wallet-balance" title="Wallet balance">
                  {balance === null ? "— SOL" : `${formatSol(balance)} SOL`}
                </span>
                <button
                  className="button button-small wallet-address"
                  type="button"
                  aria-label="Copy wallet address"
                  title={`${walletLabel}: ${address}`}
                  onClick={() => void copyAddress()}
                >
                  {shorten(address)}
                </button>
                {onRequestFunds ? (
                  <button
                    className="button button-small button-yellow"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void requestFunds()}
                  >
                    {pending === "fund" ? "Adding…" : "+ Test SOL"}
                  </button>
                ) : null}
                {onDisconnect ? (
                  <button
                    className="button button-small"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void disconnect()}
                  >
                    {pending === "disconnect" ? "Signing out…" : "Sign out"}
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button
                  className="button button-yellow"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void connect()}
                >
                  {pending === "connect" ? "Starting…" : connectLabel}
                </button>
                {secondaryConnect ? (
                  <button
                    className="button"
                    type="button"
                    disabled={pending !== null}
                    onClick={secondaryConnect.onClick}
                  >
                    {secondaryConnect.label}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {notice || signature ? (
          <div
            className={notice ? "message message-success" : "message"}
            role="status"
          >
            <p className="message-text">
              {notice}
              {signature ? (
                <a
                  className="message-link"
                  href={explorerUrl("tx", signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction ↗
                </a>
              ) : null}
            </p>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setNotice(null);
                setSignature(null);
              }}
              aria-label="Dismiss update"
            >
              ✕
            </button>
          </div>
        ) : null}
        {error ? (
          <div
            className="message message-error"
            role="alert"
            ref={errorMessage}
          >
            <p className="message-text">{error}</p>
            <button
              className="icon-button"
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        ) : null}

        <div className="workspace">
          <section className="panel" aria-labelledby="create-heading">
            <div className="panel-head">
              <h2 id="create-heading">New pot</h2>
            </div>
            <div className="tabs" role="tablist" aria-label="Pot type">
              <button
                className="tab"
                type="button"
                role="tab"
                id="create-tab-single"
                aria-controls="create-panel-single"
                aria-selected={createMode === "single"}
                onClick={() => setCreateMode("single")}
              >
                Single
              </button>
              <button
                className="tab"
                type="button"
                role="tab"
                id="create-tab-group"
                aria-controls="create-panel-group"
                aria-selected={createMode === "group"}
                onClick={() => setCreateMode("group")}
              >
                Group
              </button>
            </div>
            <form
              className="form"
              id="create-panel-single"
              role="tabpanel"
              aria-labelledby="create-tab-single"
              hidden={createMode !== "single"}
              onSubmit={createPot}
              noValidate
            >
              <label className="field">
                Task
                <span
                  className={`counter ${taskBytes > MAX_TASK_BYTES ? "counter-over" : ""}`}
                >
                  {taskBytes}/{MAX_TASK_BYTES}
                </span>
                <textarea
                  disabled={pending === "create"}
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  maxLength={MAX_TASK_BYTES}
                  placeholder="Finish the pitch before the demo"
                />
              </label>
              <div className="field-grid">
                <label className="field">
                  Stake (SOL)
                  <input
                    disabled={pending === "create"}
                    value={stake}
                    onChange={(event) => setStake(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.01"
                  />
                </label>
                <label className="field">
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
              <div className="chips" role="group" aria-label="Quick deadlines">
                <button
                  type="button"
                  className="chip"
                  disabled={pending === "create"}
                  onClick={() => setDeadline(deadlineFromNow(60))}
                >
                  +1h
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={pending === "create"}
                  onClick={() => setDeadline(deadlineFromNow(240))}
                >
                  +4h
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={pending === "create"}
                  onClick={() => setDeadline(deadlineEndOfDay())}
                >
                  End of day
                </button>
              </div>
              <label className="field">
                Judge
                <input
                  disabled={pending === "create"}
                  value={judge}
                  onChange={(event) => setJudge(event.target.value)}
                  placeholder="Wallet address (blank = you)"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                className="button button-yellow button-block"
                type="submit"
                disabled={
                  pending !== null ||
                  (wallet !== undefined && programReady !== true)
                }
              >
                {pending === "create" ? "Creating…" : "Create pot"}
              </button>
            </form>
            <div
              id="create-panel-group"
              role="tabpanel"
              aria-labelledby="create-tab-group"
              hidden={createMode !== "group"}
            >
              <GroupChallengeForm
                connection={connection}
                wallet={wallet}
                pending={pending !== null}
                onPendingChange={(active) => {
                  setPending(active ? "group" : null);
                  if (active) {
                    setError(null);
                    setNotice(null);
                    setSignature(null);
                  }
                }}
                onConnect={connect}
                onResult={afterTransaction}
                onError={showTransactionError}
                programReady={programReady === true}
              />
            </div>
          </section>

          <section aria-labelledby="pots-heading">
            <div className="pots-toolbar">
              <h2 id="pots-heading">Pots</h2>
              {pots.length > 0 ? (
                <div
                  className="segmented"
                  role="group"
                  aria-label="Filter pots"
                >
                  {filters.map((option) => (
                    <button
                      key={option.value}
                      className="segment"
                      type="button"
                      aria-pressed={filter === option.value}
                      onClick={() => setFilter(option.value)}
                    >
                      {option.label}
                      {option.count !== null ? (
                        <span className="segment-count">{option.count}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                className="button button-small"
                type="button"
                disabled={loadingPots}
                onClick={() =>
                  void Promise.all([refreshPots(), refreshBalance(true)])
                }
              >
                {loadingPots ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {groupFilter ? (
              <div className="group-bar">
                <span>
                  Group {groupFilter.split(":").at(-1)} · {visiblePots.length}{" "}
                  pots
                </span>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => {
                    setGroupFilter(null);
                    const url = new URL(window.location.href);
                    url.searchParams.delete("group");
                    window.history.replaceState(null, "", url);
                  }}
                >
                  Show all
                </button>
              </div>
            ) : null}
            {loadError ? (
              <div className="message message-error" role="alert">
                <p className="message-text">{loadError}</p>
              </div>
            ) : null}
            {programReady === false ? (
              <div className="empty">
                <h3>Program unavailable on {SOLANA_NETWORK}</h3>
              </div>
            ) : null}
            {loadingPots && pots.length === 0 ? (
              <div className="empty">
                <p className="loading">Loading pots…</p>
              </div>
            ) : null}
            {!loadingPots && !loadError && programReady && pots.length === 0 ? (
              <div className="empty">
                <h3>No pots yet</h3>
              </div>
            ) : null}
            {!loadingPots && pots.length > 0 && visiblePots.length === 0 ? (
              <div className="empty">
                <h3>
                  {filter === "mine"
                    ? "No pots for this wallet"
                    : filter === "all"
                      ? "No pots in this group"
                      : `No ${filter} pots`}
                </h3>
              </div>
            ) : null}
            <div className="pot-list">
              {visiblePots.map((pot) => {
                const group = groupTags.get(pot.publicKey.toBase58());
                const displayTask = group?.task ?? pot.task;
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
                const refundAt =
                  Number(asBigInt(pot.deadline)) + SETTLEMENT_GRACE_SECONDS;
                // One hand-off instant, allowing for a trailing chain clock, so the
                // judge keeps their whole on-chain window and no state is dead.
                const judgeWindowExpired =
                  refundAt + CLOCK_DRIFT_SECONDS <= Math.floor(now / 1000);
                const deadlineSeconds =
                  Number(asBigInt(pot.deadline)) - Math.floor(now / 1000);
                const deadlineApproaching =
                  !pot.settled &&
                  deadlineSeconds > 0 &&
                  deadlineSeconds <= 3600;
                const isJudge = address === pot.judge.toBase58();
                const participantCount =
                  pot.yesParticipants.length + pot.noParticipants.length;
                const unopposed =
                  participantCount > 0 &&
                  (!pot.yesParticipants.length || !pot.noParticipants.length);
                const timedOut = pot.settled && pot.outcome === null;
                const forfeited =
                  pot.settled && unopposed && pot.outcome === false;
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
                  pot.settled &&
                  (timedOut || (unopposed && pot.outcome === true));
                const won = pot.settled && (pot.outcome ? joinedYes : joinedNo);
                const confirming =
                  !pot.settled &&
                  settlement?.pot === pot.publicKey.toBase58() &&
                  isJudge &&
                  !judgeWindowExpired;
                const selectedWinners = settlement?.completed
                  ? pot.yesParticipants
                  : pot.noParticipants;
                // Only read for opposed pots; the unopposed copy states its own amounts.
                const reviewPayout = selectedWinners.length
                  ? pool / BigInt(selectedWinners.length)
                  : 0n;
                const yesPercent = participantCount
                  ? (pot.yesParticipants.length / participantCount) * 100
                  : 50;
                const deadlineDate = new Date(
                  Number(asBigInt(pot.deadline)) * 1000,
                );
                const judgeAddress = pot.judge.toBase58();
                // Only an opposed verdict has a winning side. A timeout refund,
                // an unopposed refund, and a forfeiture to the judge have none.
                const winningSide =
                  pot.settled && !timedOut && !unopposed && participantCount > 0
                    ? pot.outcome
                      ? "YES"
                      : "NO"
                    : null;
                const [statusLabel, statusTone] = pot.settled
                  ? timedOut
                    ? ["Refunded", "tag-gray"]
                    : pot.outcome
                      ? ["Completed", "tag-green"]
                      : ["Not completed", "tag-pink"]
                  : judgeWindowExpired
                    ? ["Refund available", "tag-orange"]
                    : deadlinePassed
                      ? ["Awaiting judge", "tag-yellow"]
                      : participantCount === MAX_PARTICIPANTS
                        ? ["Full", "tag-gray"]
                        : ["Open", "tag-blue"];
                const resultTone =
                  !pot.settled || refunded || forfeited
                    ? ""
                    : won
                      ? "pot-you-won"
                      : "pot-you-lost";
                return (
                  <article
                    className={`pot ${pot.settled ? "pot-settled" : ""}`}
                    key={pot.publicKey.toBase58()}
                    id={`pot-${pot.publicKey.toBase58()}`}
                    tabIndex={-1}
                    aria-label={displayTask}
                  >
                    <div className="pot-head">
                      <span className={`tag ${statusTone}`}>{statusLabel}</span>
                      {!pot.settled ? (
                        <time
                          className={`pot-countdown ${deadlineApproaching ? "is-urgent" : ""}`}
                          dateTime={deadlineDate.toISOString()}
                          title={deadlineDate.toLocaleString()}
                        >
                          {timeRemaining(pot.deadline, now)}
                        </time>
                      ) : null}
                    </div>

                    <h3 className="pot-task">{displayTask}</h3>

                    {group ? (
                      <div className="pot-tags">
                        <button
                          type="button"
                          className="tag tag-button"
                          title="Show this group"
                          onClick={() => {
                            setGroupFilter(
                              `${pot.creator.toBase58()}:${group.groupId}`,
                            );
                            setFilter("all");
                          }}
                        >
                          Group {group.groupId}
                        </button>
                        <span>
                          For{" "}
                          {group.participant === address
                            ? "you"
                            : shorten(group.participant)}
                        </span>
                        {!pot.settled &&
                        !pot.yesParticipants.some(
                          (person) => person.toBase58() === group.participant,
                        ) ? (
                          <span className="tag tag-yellow">Awaiting YES</span>
                        ) : null}
                      </div>
                    ) : null}

                    <dl className="pot-stats">
                      <div>
                        <dt>Stake</dt>
                        <dd>{formatSol(pot.stake)} SOL</dd>
                      </div>
                      <div>
                        <dt>Pool</dt>
                        <dd>{formatSol(pool)} SOL</dd>
                      </div>
                      <div>
                        <dt>Deadline</dt>
                        <dd title={deadlineDate.toLocaleString()}>
                          {formatDeadline(pot.deadline)}
                        </dd>
                      </div>
                      <div>
                        <dt>Judge</dt>
                        <dd>
                          <button
                            className="link-button"
                            type="button"
                            title={`Copy judge address: ${judgeAddress}`}
                            onClick={() =>
                              void copyWalletAddress(judgeAddress, "Judge")
                            }
                          >
                            {isJudge ? "You" : shorten(judgeAddress)}
                          </button>
                        </dd>
                      </div>
                    </dl>

                    <div className="split">
                      <div className="split-labels" aria-hidden="true">
                        <span>
                          YES {pot.yesParticipants.length}
                          {winningSide === "YES" ? " ✓" : ""}
                        </span>
                        <span>
                          {participantCount}/{MAX_PARTICIPANTS}
                        </span>
                        <span>
                          {winningSide === "NO" ? "✓ " : ""}NO{" "}
                          {pot.noParticipants.length}
                        </span>
                      </div>
                      <div
                        className={`split-bar ${participantCount === 0 ? "split-bar-empty" : ""}`}
                        role="img"
                        aria-label={`Participant split: YES ${pot.yesParticipants.length}, NO ${pot.noParticipants.length}${winningSide ? `. ${winningSide} won.` : pot.settled ? ". Settled with no winning side." : "."}`}
                      >
                        <span
                          className={`split-yes ${winningSide === "NO" ? "is-loser" : ""}`}
                          style={{ width: `${yesPercent}%` }}
                        />
                        <span
                          className={`split-no ${winningSide === "YES" ? "is-loser" : ""}`}
                          style={{ width: `${100 - yesPercent}%` }}
                        />
                      </div>
                    </div>

                    {pot.settled ? (
                      <p className="pot-summary">
                        {participantCount === 0
                          ? "Empty pot · no payout"
                          : timedOut
                            ? "Judge timed out · stakes refunded"
                            : refunded
                              ? "Unopposed · stakes refunded"
                              : forfeited
                                ? "Unopposed · pool sent to judge"
                                : `Paid ${winners.length} ${pot.outcome ? "YES" : "NO"} ${winners.length === 1 ? "winner" : "winners"}`}
                      </p>
                    ) : null}

                    {joined ? (
                      <p className={`pot-you ${resultTone}`} role="status">
                        {pot.settled
                          ? refunded
                            ? `Refunded ${formatSol(pot.stake)} SOL`
                            : forfeited
                              ? `Your ${formatSol(pot.stake)} SOL went to the judge`
                              : won
                                ? `${joinedYes ? "YES" : "NO"} won · you got ${formatSol(winnerPayout)} SOL`
                                : `${joinedYes ? "YES" : "NO"} lost · ${formatSol(pot.stake)} SOL`
                          : `You: ${joinedYes ? "YES" : "NO"} · ${formatSol(pot.stake)} SOL`}
                      </p>
                    ) : null}

                    {!pot.settled && (unopposed || participantCount === 0) ? (
                      <p className="pot-warning">
                        <strong>Unopposed:</strong> “Not completed” sends the
                        pool to the judge.
                      </p>
                    ) : null}

                    {!pot.settled && !deadlinePassed && !joined ? (
                      <div className="pot-actions">
                        <button
                          className="button button-green"
                          type="button"
                          title="Task will be completed"
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
                          className="button button-pink"
                          type="button"
                          title="Task will not be completed"
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
                    ) : null}

                    {!pot.settled &&
                    deadlinePassed &&
                    isJudge &&
                    !judgeWindowExpired ? (
                      <div className="pot-verdict">
                        <p className="pot-label">
                          Your verdict · until {formatDeadline(refundAt)}
                        </p>
                        <div className="pot-actions">
                          <button
                            className="button button-green"
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
                            className="button button-pink"
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
                        className="review"
                        role="region"
                        aria-label="Review settlement"
                      >
                        <p className="review-title">
                          Settle as{" "}
                          {settlement.completed ? "completed" : "not completed"}
                          ?
                        </p>
                        <p className="review-text">
                          {participantCount === 0
                            ? "Empty pot. No payout."
                            : unopposed
                              ? settlement.completed
                                ? `Each participant gets back ${formatSol(pot.stake)} SOL.`
                                : `${formatSol(pool)} SOL goes to the judge (${shorten(pot.judge.toBase58())}).`
                              : selectedWinners.length === 1
                                ? `The ${settlement.completed ? "YES" : "NO"} participant gets ${formatSol(reviewPayout)} SOL.`
                                : `${selectedWinners.length} ${settlement.completed ? "YES" : "NO"} participants get ${formatSol(reviewPayout)} SOL each.`}{" "}
                          Final.
                        </p>
                        <div className="pot-actions">
                          <button
                            className="button button-ink"
                            type="button"
                            disabled={pending !== null || programReady !== true}
                            onClick={() =>
                              void settlePot(pot, settlement.completed)
                            }
                          >
                            {settlementPending ? "Settling…" : "Confirm"}
                          </button>
                          <button
                            className="button"
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

                    {!pot.settled && judgeWindowExpired ? (
                      <div className="pot-verdict">
                        <p className="pot-label">Judge window closed</p>
                        <button
                          className="button button-yellow button-block"
                          type="button"
                          disabled={pending !== null || programReady !== true}
                          onClick={() => void refundPot(pot)}
                        >
                          {pending === `refund-${pot.publicKey.toBase58()}`
                            ? "Refunding…"
                            : "Refund all stakes"}
                        </button>
                      </div>
                    ) : null}

                    {!pot.settled &&
                    deadlinePassed &&
                    !isJudge &&
                    !judgeWindowExpired ? (
                      <p className="pot-label">
                        Judge decides until {formatDeadline(refundAt)}
                      </p>
                    ) : null}

                    <div className="pot-foot">
                      <details className="participants">
                        <summary>Participants ({participantCount})</summary>
                        {participantCount === 0 ? (
                          <p>None yet</p>
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
                                <span
                                  className={`tag ${side === "YES" ? "tag-green" : "tag-pink"}`}
                                >
                                  {side}
                                </span>
                                <a
                                  className="link"
                                  href={explorerUrl(
                                    "address",
                                    person.toBase58(),
                                  )}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={person.toBase58()}
                                >
                                  {shorten(person.toBase58())}
                                </a>
                                {person.toBase58() === address ? (
                                  <span>(you)</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                      <a
                        className="link"
                        href={explorerUrl("address", pot.publicKey.toBase58())}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Explorer ↗
                      </a>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => void sharePot(pot)}
                      >
                        Share
                      </button>
                    </div>

                    {sharedPot?.address === pot.publicKey.toBase58() ? (
                      <div className="share">
                        <input
                          type="url"
                          readOnly
                          aria-label="Pot link"
                          value={sharedPot.url}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <span className="share-note">
                          {sharedPot.copied ? "Copied" : "Copy this link"}
                          {IS_LOCALNET || sharedPot.local
                            ? " · this computer only"
                            : ""}
                        </span>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
