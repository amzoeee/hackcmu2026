"use client";

import { AnchorProvider, BN, utils } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  getAccountabilityProgram,
  getReadOnlyAccountabilityProgram,
  getReadOnlyConnection,
} from "@/lib/anchor/client";
import {
  checkGroupSubmission,
  encodeGroupTask,
  groupTaskBytes,
  MAX_GROUP_TASK_BYTES,
  packGroupTransactions,
  parseGroupTask,
  type GroupSubmission,
} from "@/lib/group-challenge";
import {
  asBigInt,
  deadlineEndOfDay,
  deadlineFromNow,
  formatSol,
  parseSol,
  potAddress,
  POT_ACCOUNT_BYTES,
} from "@/lib/pot-values";
import { SOLANA_NETWORK, SOLANA_RPC_URL } from "@/lib/solana";

type GroupPlan = {
  groupId: string;
  organizer: string;
  judge: string;
  stake: string;
  deadline: number;
  entries: {
    participant: string;
    task: string;
    identifier: string;
    pot: string;
    created: boolean;
    joined: boolean;
  }[];
  signatures: string[];
  pending?: GroupSubmission;
};

type Props = {
  connection: Connection;
  wallet?: AnchorWallet;
  pending: boolean;
  programReady: boolean;
  onPendingChange: (pending: boolean) => void;
  onConnect: () => void | Promise<void>;
  onResult: (message: string, signature?: string) => void;
  onError: (error: unknown) => void;
};

function transactionUrl(signature: string) {
  const cluster =
    SOLANA_NETWORK === "localnet"
      ? `custom&customUrl=${encodeURIComponent(SOLANA_RPC_URL)}`
      : SOLANA_NETWORK;
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function GroupChallengeForm({
  connection,
  wallet,
  pending,
  programReady,
  onPendingChange,
  onConnect,
  onResult,
  onError,
}: Props) {
  const [friends, setFriends] = useState([
    { participant: "", task: "" },
    { participant: "", task: "" },
  ]);
  const [stake, setStake] = useState("0.01");
  const [deadline, setDeadline] = useState("");
  const [judge, setJudge] = useState("");
  const [plan, setPlan] = useState<GroupPlan | null>(null);
  const [verified, setVerified] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [rent, setRent] = useState<number | null>(null);
  const [progress, setProgress] = useState("");
  const running = useRef(false);
  const readConnection = useMemo(
    () => getReadOnlyConnection(connection.rpcEndpoint),
    [connection.rpcEndpoint],
  );
  const reader = useMemo(
    () => getReadOnlyAccountabilityProgram(readConnection),
    [readConnection],
  );
  const storageKey = `solara:group:v1:${SOLANA_NETWORK}:${connection.rpcEndpoint}:${reader.programId.toBase58()}:${wallet?.publicKey.toBase58() ?? "disconnected"}`;
  const currentStorageKey = useRef(storageKey);

  useEffect(() => {
    currentStorageKey.current = storageKey;
    const timer = window.setTimeout(() => {
      setPlan(null);
      setVerified(false);
      setProgress("");
      setStorageError(false);
      setConfirmLeave(false);
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const value = JSON.parse(saved) as GroupPlan;
          if (
            !value ||
            typeof value.groupId !== "string" ||
            typeof value.organizer !== "string" ||
            typeof value.judge !== "string" ||
            typeof value.stake !== "string" ||
            !Number.isSafeInteger(value.deadline) ||
            !Array.isArray(value.entries) ||
            value.entries.length < 2 ||
            value.entries.length > 10 ||
            !value.entries.every(
              (entry) =>
                entry &&
                typeof entry.participant === "string" &&
                typeof entry.task === "string" &&
                typeof entry.identifier === "string" &&
                typeof entry.pot === "string" &&
                typeof entry.created === "boolean" &&
                typeof entry.joined === "boolean",
            ) ||
            !Array.isArray(value.signatures) ||
            !value.signatures.every(
              (signature) => typeof signature === "string",
            ) ||
            (value.pending &&
              (typeof value.pending.signature !== "string" ||
                typeof value.pending.blockhash !== "string" ||
                !Number.isSafeInteger(value.pending.lastValidBlockHeight)))
          )
            throw new Error();
          setPlan(value);
        }
      } catch {
        setStorageError(true);
      }
      setLoadedKey(storageKey);
      setDeadline(deadlineFromNow(15));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    let current = true;
    void readConnection
      .getMinimumBalanceForRentExemption(POT_ACCOUNT_BYTES)
      .then((value) => {
        if (current) setRent(value);
      })
      .catch(() => {
        if (current) setRent(null);
      });
    return () => {
      current = false;
    };
  }, [readConnection]);

  const activePlan = loadedKey === storageKey ? plan : null;
  const count = activePlan?.entries.length ?? friends.length;
  const complete =
    verified &&
    activePlan?.entries.every((entry) => entry.created && entry.joined) ===
      true &&
    !activePlan.pending;
  let stakeLamports: bigint | null = null;
  try {
    stakeLamports = activePlan ? BigInt(activePlan.stake) : parseSol(stake);
  } catch {
    /* Show the estimate when the amount is valid. */
  }
  const estimatedFees = BigInt(count * 2 * 5_000);
  const unstakedPots =
    activePlan?.entries.filter((entry) => entry.created && !entry.joined)
      .length ?? 0;
  const friendBytes = friends.map((friend) =>
    groupTaskBytes(friend.participant, friend.task),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet) return onConnect();
    if (
      pending ||
      running.current ||
      loadedKey !== storageKey ||
      storageError ||
      !programReady
    )
      return;
    running.current = true;
    onPendingChange(true);
    let active = activePlan;
    const showProgress = (message: string) => {
      if (currentStorageKey.current === storageKey) setProgress(message);
    };
    const save = (next: GroupPlan) => {
      // A failed save stops submission so reload recovery is always available.
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      active = next;
      if (currentStorageKey.current === storageKey) setPlan(next);
    };
    try {
      if (!active) {
        const amount = parseSol(stake);
        const deadlineSeconds = Math.floor(new Date(deadline).getTime() / 1000);
        if (
          !Number.isFinite(deadlineSeconds) ||
          deadlineSeconds <= Math.floor(Date.now() / 1000) + 30
        )
          throw new Error(
            "Choose a deadline at least 30 seconds from now so your friends have time to join.",
          );
        let judgeKey: PublicKey;
        try {
          judgeKey = new PublicKey(judge.trim() || wallet.publicKey);
          if (!PublicKey.isOnCurve(judgeKey.toBytes())) throw new Error();
        } catch {
          throw new Error(
            "Enter a valid judge wallet, or leave it blank to judge the group yourself.",
          );
        }
        const groupId = Array.from(
          crypto.getRandomValues(new Uint8Array(4)),
          (value) => value.toString(16).padStart(2, "0"),
        ).join("");
        const identifiers = crypto.getRandomValues(new Uint32Array(2));
        const firstId =
          (BigInt(identifiers[0]) << 32n) | BigInt(identifiers[1]);
        const seen = new Set<string>();
        const entries = friends.map((friend, index) => {
          let participant: PublicKey;
          try {
            participant = new PublicKey(friend.participant.trim());
            if (!PublicKey.isOnCurve(participant.toBytes())) throw new Error();
          } catch {
            throw new Error(
              `Friend ${index + 1} needs a valid wallet address.`,
            );
          }
          const address = participant.toBase58();
          if (participant.equals(wallet.publicKey))
            throw new Error(
              "Friends must use different wallets from the organizer, who takes NO on every pot.",
            );
          if (seen.has(address))
            throw new Error("Use a different wallet for each friend.");
          seen.add(address);
          const identifier = (
            (firstId + BigInt(index)) &
            0xffffffffffffffffn
          ).toString();
          return {
            participant: address,
            task: encodeGroupTask(groupId, participant, friend.task),
            identifier,
            pot: potAddress(
              wallet.publicKey,
              identifier,
              reader.programId,
            ).toBase58(),
            created: false,
            joined: false,
          };
        });
        save({
          groupId,
          organizer: wallet.publicKey.toBase58(),
          judge: judgeKey.toBase58(),
          stake: amount.toString(),
          deadline: deadlineSeconds,
          entries,
          signatures: [],
        });
      }
      if (!active) throw new Error("The group draft could not be saved.");
      if (
        active.organizer !== wallet.publicKey.toBase58() ||
        !/^[0-9a-f]{8}$/.test(active.groupId) ||
        !/^\d+$/.test(active.stake) ||
        BigInt(active.stake) <= 0n ||
        !Number.isSafeInteger(active.deadline)
      )
        throw new Error("This saved group draft is invalid.");
      const seen = new Set<string>();
      for (const entry of active.entries) {
        const key = new PublicKey(entry.participant);
        const tag = parseGroupTask(entry.task);
        if (
          !PublicKey.isOnCurve(key.toBytes()) ||
          key.equals(wallet.publicKey) ||
          seen.has(entry.participant) ||
          !tag ||
          tag.groupId !== active.groupId ||
          tag.participant !== entry.participant ||
          !/^\d+$/.test(entry.identifier) ||
          BigInt(entry.identifier) > 0xffffffffffffffffn ||
          potAddress(
            wallet.publicKey,
            entry.identifier,
            reader.programId,
          ).toBase58() !== entry.pot
        )
          throw new Error("This saved group draft is invalid.");
        seen.add(entry.participant);
      }
      if (active.pending) {
        showProgress("Checking the previous transaction before resuming…");
        const unresolved = active.pending;
        const confirmed =
          (await checkGroupSubmission(readConnection, unresolved)) ===
          "confirmed";
        save({
          ...active,
          pending: undefined,
          signatures:
            confirmed && !active.signatures.includes(unresolved.signature)
              ? [...active.signatures, unresolved.signature]
              : active.signatures,
        });
      }

      const reconcile = async () => {
        if (!active) throw new Error("The group draft is unavailable.");
        const accounts = await reader.account.pot.fetchMultiple(
          active.entries.map((entry) => new PublicKey(entry.pot)),
        );
        const entries = active.entries.map((entry, index) => {
          const account = accounts[index];
          if (
            account &&
            (!account.creator.equals(wallet.publicKey) ||
              account.task !== entry.task ||
              asBigInt(account.stake).toString() !== active!.stake ||
              Number(asBigInt(account.deadline)) !== active!.deadline ||
              account.judge.toBase58() !== active!.judge)
          )
            throw new Error(
              "A saved pot does not match this group draft. Setup has stopped.",
            );
          if (
            account?.yesParticipants.some((key) => key.equals(wallet.publicKey))
          )
            throw new Error(
              "The organizer already joined YES on one of these pots and cannot take NO. The existing pots remain available below.",
            );
          return {
            ...entry,
            created: account !== null,
            joined:
              account?.noParticipants.some((key) =>
                key.equals(wallet.publicKey),
              ) ?? false,
          };
        });
        save({ ...active, entries });
        if (currentStorageKey.current === storageKey) setVerified(true);
      };
      await reconcile();
      if (active.entries.every((entry) => entry.created && entry.joined)) {
        const message =
          active.deadline <= Math.floor(Date.now() / 1000)
            ? "Group setup is complete and the deadline has passed. Open the existing pots below to review settlement or refunds."
            : "Group ready. Share the group link below so each friend can join YES.";
        showProgress(message);
        onResult(message, active.signatures.at(-1));
        return;
      }
      if (active.deadline <= Math.floor(Date.now() / 1000) + 10)
        throw new Error(
          "This group's deadline has passed or is too close to finish setup. Created pots remain listed below; their judge or timeout refund can return their stakes.",
        );
      const missingCreates = active.entries.filter((entry) => !entry.created);
      const missingJoins = active.entries.filter((entry) => !entry.joined);
      showProgress("Checking the organizer's funding…");
      const [rentNow, balance] = await Promise.all([
        readConnection.getMinimumBalanceForRentExemption(POT_ACCOUNT_BYTES),
        readConnection.getBalance(wallet.publicKey),
      ]);
      const reserve =
        BigInt(missingCreates.length * rentNow) +
        BigInt(missingJoins.length) * BigInt(active.stake) +
        BigInt((missingCreates.length + missingJoins.length) * 5_000);
      if (BigInt(balance) < reserve)
        throw new Error(
          `The organizer needs approximately ${formatSol(reserve)} SOL to finish rent, NO stakes, and fees. Add test SOL, then resume.`,
        );

      // Anchor overwrites recentBlockhash inside sendAndConfirm, so the only way
      // to learn a transaction's expiry is to observe that call. Record the whole
      // result and match it to what the wallet signed, so a changed call path
      // fails loudly instead of saving an expiry that was never read.
      let latestBlockhash: Readonly<{
        blockhash: string;
        lastValidBlockHeight: number;
      }> | null = null;
      const signingWallet: AnchorWallet = {
        publicKey: wallet.publicKey,
        signAllTransactions: wallet.signAllTransactions.bind(wallet),
        signTransaction: async (transaction) => {
          if (currentStorageKey.current !== storageKey)
            throw new Error(
              "The wallet changed. Switch back to resume its saved group setup.",
            );
          const signed = await wallet.signTransaction(transaction);
          if (currentStorageKey.current !== storageKey)
            throw new Error(
              "The wallet changed before submission. Switch back to resume its saved group setup.",
            );
          if (
            !(signed instanceof Transaction) ||
            !signed.signature ||
            !signed.recentBlockhash ||
            !active
          )
            throw new Error(
              "The wallet returned an incomplete group transaction.",
            );
          const prepared = latestBlockhash;
          if (!prepared || prepared.blockhash !== signed.recentBlockhash)
            throw new Error(
              "This transaction's expiry could not be recorded, so it was not submitted. Reload and use Resume to continue safely.",
            );
          save({
            ...active,
            pending: {
              signature: utils.bytes.bs58.encode(signed.signature),
              blockhash: signed.recentBlockhash,
              lastValidBlockHeight: prepared.lastValidBlockHeight,
            },
          });
          return signed;
        },
      };
      const program = getAccountabilityProgram(connection, signingWallet);
      const provider = program.provider as AnchorProvider;
      const getLatestBlockhash = provider.connection.getLatestBlockhash.bind(
        provider.connection,
      );
      provider.connection.getLatestBlockhash = async (...args) => {
        const latest = await getLatestBlockhash(...args);
        latestBlockhash = latest;
        return latest;
      };
      const createInstructions = await Promise.all(
        missingCreates.map((entry) =>
          program.methods
            .createPot(
              new BN(entry.identifier),
              entry.task,
              new BN(active!.stake),
              new BN(active!.deadline),
              new PublicKey(active!.judge),
            )
            .accountsPartial({
              creator: wallet.publicKey,
              pot: new PublicKey(entry.pot),
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ),
      );
      const joinInstructions = await Promise.all(
        missingJoins.map((entry) =>
          program.methods
            .joinPot({ no: {} })
            .accountsPartial({
              participant: wallet.publicKey,
              pot: new PublicKey(entry.pot),
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ),
      );
      // All creates precede joins, so a missing friend never holds up another pot's creation.
      const createBatches = packGroupTransactions(
        createInstructions,
        wallet.publicKey,
      );
      const joinBatches = packGroupTransactions(
        joinInstructions,
        wallet.publicKey,
      );
      const batches = [...createBatches, ...joinBatches];
      for (let index = 0; index < batches.length; index++) {
        if (currentStorageKey.current !== storageKey)
          throw new Error(
            "The wallet changed. Switch back to resume its saved group setup.",
          );
        showProgress(
          `${index < createBatches.length ? "Creating pots" : "Adding your NO stakes"} · transaction ${index + 1} of ${batches.length}. Approve in your wallet.`,
        );
        // Never let one batch's expiry stand in for the next one's.
        latestBlockhash = null;
        const signature = await provider.sendAndConfirm(batches[index]);
        save({
          ...active,
          pending: undefined,
          signatures: [...active.signatures, signature],
        });
        onResult(
          `Group setup: transaction ${index + 1} of ${batches.length} confirmed.`,
          signature,
        );
        await reconcile();
      }
      showProgress(
        "Group ready. Each friend can now join YES on their own pot.",
      );
      onResult(
        "Group created and the organizer's NO stakes are in. Share the group link below so each friend can join YES.",
        active.signatures.at(-1),
      );
    } catch (error) {
      if (
        active?.pending &&
        error instanceof SendTransactionError &&
        error.message.startsWith("Simulation failed.")
      ) {
        // An explicit preflight rejection never broadcast this transaction.
        try {
          save({ ...active, pending: undefined });
        } catch {
          /* Preserve the transaction error if storage also failed. */
        }
      }
      // Nothing is saved until a draft exists, so do not promise recoverable
      // progress for an error raised while validating the form.
      showProgress(
        active
          ? "Setup paused. Confirmed pots and stakes are saved; Resume checks the chain before continuing."
          : "",
      );
      if (error instanceof Error && active?.pending)
        Object.assign(error, { signature: active.pending.signature });
      onError(error);
    } finally {
      running.current = false;
      onPendingChange(false);
    }
  }

  function startAnother() {
    if (pending || activePlan?.pending) return;
    // Abandoning created pots before the organizer stakes leaves each friend
    // betting against a judge with nothing at risk, so ask once.
    if (unstakedPots > 0 && !confirmLeave) return setConfirmLeave(true);
    window.localStorage.removeItem(storageKey);
    setPlan(null);
    setVerified(false);
    setStorageError(false);
    setConfirmLeave(false);
    setProgress("");
  }

  async function copyGroupLink() {
    if (!activePlan) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("pot");
    url.hash = "";
    url.searchParams.set(
      "group",
      `${activePlan.organizer}:${activePlan.groupId}`,
    );
    try {
      await navigator.clipboard.writeText(url.toString());
      onResult(
        "Group link copied. Send it to your friends so they can join YES on their own pots.",
      );
    } catch {
      onError(new Error(`Copy this group link: ${url.toString()}`));
    }
  }

  return (
    <details className="group-challenge">
      <summary>Group challenge · one task per friend</summary>
      <form className="create-form" onSubmit={submit} noValidate>
        <p className="form-note">
          You pay to create each pot and stake NO on every task. Each friend
          connects their own wallet and stakes YES. The judge decides each task
          separately.
        </p>
        {!activePlan ? (
          <>
            {friends.map((friend, index) => (
              <fieldset className="group-friend" key={index} disabled={pending}>
                <legend>Friend {index + 1}</legend>
                <label>
                  Friend&apos;s wallet
                  <input
                    value={friend.participant}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setFriends(
                        friends.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, participant: event.target.value }
                            : row,
                        ),
                      )
                    }
                    placeholder="Their YES wallet address"
                  />
                </label>
                <label>
                  Their task
                  <textarea
                    value={friend.task}
                    maxLength={160}
                    onChange={(event) =>
                      setFriends(
                        friends.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, task: event.target.value }
                            : row,
                        ),
                      )
                    }
                    placeholder="Sam: finish the pitch before the demo"
                  />
                </label>
                <span
                  className={`field-note ${friendBytes[index] > MAX_GROUP_TASK_BYTES ? "field-error" : ""}`}
                >
                  {friendBytes[index]}/{MAX_GROUP_TASK_BYTES} bytes including
                  the group tag.
                </span>
                {friends.length > 2 ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setFriends(
                        friends.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  >
                    Remove friend {index + 1}
                  </button>
                ) : null}
              </fieldset>
            ))}
            {friends.length < 10 ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={pending}
                onClick={() =>
                  setFriends([...friends, { participant: "", task: "" }])
                }
              >
                Add friend
              </button>
            ) : null}
            <div className="form-grid">
              <label>
                Stake per pot (SOL)
                <input
                  value={stake}
                  disabled={pending}
                  inputMode="decimal"
                  onChange={(event) => setStake(event.target.value)}
                />
              </label>
              <label>
                Shared deadline
                <input
                  type="datetime-local"
                  step="1"
                  value={deadline}
                  disabled={pending}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </label>
            </div>
            <div className="deadline-presets" aria-label="Quick deadlines">
              <span>From now</span>
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => setDeadline(deadlineFromNow(60))}
              >
                1 hr
              </button>
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => setDeadline(deadlineFromNow(240))}
              >
                4 hr
              </button>
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => setDeadline(deadlineEndOfDay())}
              >
                End of Day
              </button>
            </div>
            <label>
              Judge for all tasks
              <input
                value={judge}
                disabled={pending}
                onChange={(event) => setJudge(event.target.value)}
                placeholder="Leave blank to judge them yourself"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </>
        ) : (
          <div className="group-progress">
            <p>
              <strong>Group {activePlan.groupId}</strong> ·{" "}
              {!verified ? "Saved progress · " : ""}
              {activePlan.entries.filter((entry) => entry.created).length}/
              {count} pots created ·{" "}
              {activePlan.entries.filter((entry) => entry.joined).length}/
              {count} NO stakes confirmed.
            </p>
            <ul>
              {activePlan.entries.map((entry, index) => (
                <li key={entry.pot}>
                  <a href={`#pot-${entry.pot}`}>
                    {parseGroupTask(entry.task)?.task ?? `Friend ${index + 1}`}
                  </a>{" "}
                  ·{" "}
                  {entry.joined
                    ? "NO stake added"
                    : entry.created
                      ? "Created; NO stake pending"
                      : "Creation pending"}
                </li>
              ))}
            </ul>
            {activePlan.signatures.map((signature, index) => (
              <a
                key={signature}
                href={transactionUrl(signature)}
                target="_blank"
                rel="noreferrer"
              >
                Confirmed transaction {index + 1}
              </a>
            ))}
            {activePlan.pending ? (
              <a
                href={transactionUrl(activePlan.pending.signature)}
                target="_blank"
                rel="noreferrer"
              >
                Check unresolved transaction
              </a>
            ) : null}
          </div>
        )}
        {!complete ? (
          <div className="group-cost form-note">
            {rent !== null && stakeLamports !== null ? (
              <p>
                Organizer budget: approximately{" "}
                <strong>
                  {formatSol(
                    BigInt(rent * count) +
                      stakeLamports * BigInt(count) +
                      estimatedFees,
                  )}{" "}
                  SOL
                </strong>{" "}
                total for {count} pots: {formatSol(BigInt(rent * count))}{" "}
                account rent + {formatSol(stakeLamports * BigInt(count))} NO
                stakes + up to {formatSol(estimatedFees)} estimated fees.
                Confirmed costs are already paid when resuming.
              </p>
            ) : (
              <p>
                Rent estimate unavailable until the RPC responds and the stake
                is valid. Funding is checked before setup.
              </p>
            )}
            <p>
              Creates are packed into as few transactions as fit, followed by
              your NO stakes. Approve each batch once. Friends each make one
              separate YES join.
            </p>
            <p>
              Until friends join YES, these pots have no opposing side. A
              not-completed verdict on an unopposed pot forfeits its stakes to
              the judge; disclose this to your group.
            </p>
          </div>
        ) : null}
        {storageError ? (
          <>
            <p className="field-error" role="alert">
              The saved group draft could not be read. Browser storage must be
              available before setting up a group. Existing pots remain listed
              below.
            </p>
            <button
              className="text-button"
              type="button"
              disabled={pending}
              onClick={startAnother}
            >
              Clear unreadable group draft
            </button>
          </>
        ) : null}
        {progress ? (
          <p className="form-note" role="status">
            {progress}
          </p>
        ) : null}
        {!complete ? (
          <button
            className="button button-primary"
            type="submit"
            disabled={
              pending ||
              loadedKey !== storageKey ||
              storageError ||
              (!!wallet && !programReady)
            }
          >
            {pending
              ? "Working…"
              : activePlan
                ? "Resume group setup"
                : wallet
                  ? `Create ${count} pots + stake NO`
                  : "Connect to create group"}
          </button>
        ) : null}
        {activePlan ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={pending}
            onClick={() => void copyGroupLink()}
          >
            Copy group link
          </button>
        ) : null}
        {confirmLeave && unstakedPots > 0 ? (
          <p className="risk-note" role="alert">
            {unstakedPots === 1
              ? "One created pot has no stake from you."
              : `${unstakedPots} created pots have no stake from you.`}{" "}
            A friend who joins YES there would be staking against a judge with
            nothing at risk, and a “not completed” verdict on an unopposed pot
            pays their stake to the judge. Resume instead to add your NO stakes.
          </p>
        ) : null}
        {complete || (activePlan && !activePlan.pending) ? (
          <button
            className="text-button"
            type="button"
            disabled={pending}
            onClick={startAnother}
          >
            {complete
              ? "Start another group"
              : confirmLeave && unstakedPots > 0
                ? "Leave them anyway"
                : "Leave these pots and start another group"}
          </button>
        ) : null}
      </form>
    </details>
  );
}
