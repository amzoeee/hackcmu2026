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
          throw new Error("Deadline must be at least 30 seconds away.");
        let judgeKey: PublicKey;
        try {
          judgeKey = new PublicKey(judge.trim() || wallet.publicKey);
          if (!PublicKey.isOnCurve(judgeKey.toBytes())) throw new Error();
        } catch {
          throw new Error("Invalid judge address.");
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
            throw new Error(`Friend ${index + 1}: invalid wallet address.`);
          }
          const address = participant.toBase58();
          if (participant.equals(wallet.publicKey))
            throw new Error("Friends can't use your wallet.");
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
        showProgress("Checking previous transaction…");
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
              "A saved pot doesn't match this group draft. Setup stopped.",
            );
          if (
            account?.yesParticipants.some((key) => key.equals(wallet.publicKey))
          )
            throw new Error(
              "You already joined YES on one of these pots, so you can't take NO.",
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
            ? "Group setup complete. The deadline has passed."
            : "Group ready. Share the group link.";
        showProgress(message);
        onResult(message, active.signatures.at(-1));
        return;
      }
      if (active.deadline <= Math.floor(Date.now() / 1000) + 10)
        throw new Error(
          "Deadline passed or too close to finish setup. Created pots stay listed.",
        );
      const missingCreates = active.entries.filter((entry) => !entry.created);
      const missingJoins = active.entries.filter((entry) => !entry.joined);
      showProgress("Checking balance…");
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
          `Need about ${formatSol(reserve)} SOL to finish. Add test SOL, then resume.`,
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
            throw new Error("Wallet changed. Switch back to resume.");
          const signed = await wallet.signTransaction(transaction);
          if (currentStorageKey.current !== storageKey)
            throw new Error(
              "Wallet changed before submission. Switch back to resume.",
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
              "Transaction expiry couldn't be recorded, so it wasn't sent. Reload and resume.",
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
          throw new Error("Wallet changed. Switch back to resume.");
        showProgress(
          `${index < createBatches.length ? "Creating pots" : "Adding NO stakes"} · ${index + 1}/${batches.length} · approve in wallet`,
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
          `Group setup ${index + 1}/${batches.length} confirmed.`,
          signature,
        );
        await reconcile();
      }
      showProgress("Group ready.");
      onResult(
        "Group created. Share the group link.",
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
      showProgress(active ? "Paused. Progress saved." : "");
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
      onResult("Group link copied.");
    } catch {
      onError(new Error(`Copy this group link: ${url.toString()}`));
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="hint">One pot per friend. You stake NO; they join YES.</p>
      {!activePlan ? (
        <>
          {friends.map((friend, index) => (
            <fieldset className="friend" key={index} disabled={pending}>
              <legend>Friend {index + 1}</legend>
              {friends.length > 2 ? (
                <button
                  className="chip friend-remove"
                  type="button"
                  aria-label={`Remove friend ${index + 1}`}
                  onClick={() =>
                    setFriends(
                      friends.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                >
                  Remove
                </button>
              ) : null}
              <label className="field">
                Wallet
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
                  placeholder="Friend's wallet address"
                />
              </label>
              <label className="field">
                Task
                <span
                  className={`counter ${friendBytes[index] > MAX_GROUP_TASK_BYTES ? "counter-over" : ""}`}
                >
                  {friendBytes[index]}/{MAX_GROUP_TASK_BYTES}
                </span>
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
                  placeholder="Finish the pitch before the demo"
                />
              </label>
            </fieldset>
          ))}
          {friends.length < 10 ? (
            <button
              className="button button-small button-block"
              type="button"
              disabled={pending}
              onClick={() =>
                setFriends([...friends, { participant: "", task: "" }])
              }
            >
              + Add friend
            </button>
          ) : null}
          <div className="field-grid">
            <label className="field">
              Stake / pot
              <input
                value={stake}
                disabled={pending}
                inputMode="decimal"
                onChange={(event) => setStake(event.target.value)}
              />
            </label>
            <label className="field">
              Deadline
              <input
                type="datetime-local"
                step="1"
                value={deadline}
                disabled={pending}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </label>
          </div>
          <div className="chips" role="group" aria-label="Quick deadlines">
            {[5, 15, 60].map((minutes) => (
              <button
                key={minutes}
                className="chip"
                type="button"
                disabled={pending}
                onClick={() => setDeadline(deadlineFromNow(minutes))}
              >
                {minutes === 60 ? "+1h" : `+${minutes}m`}
              </button>
            ))}
          </div>
          <label className="field">
            Judge
            <input
              value={judge}
              disabled={pending}
              onChange={(event) => setJudge(event.target.value)}
              placeholder="Wallet address (blank = you)"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <div className="box">
          <p className="cost-total">
            <span>
              Group {activePlan.groupId}
              {!verified ? " · saved" : ""}
            </span>
          </p>
          <p>
            {activePlan.entries.filter((entry) => entry.created).length}/{count}{" "}
            created ·{" "}
            {activePlan.entries.filter((entry) => entry.joined).length}/{count}{" "}
            NO staked
          </p>
          <ul>
            {activePlan.entries.map((entry, index) => (
              <li key={entry.pot}>
                <a className="link" href={`#pot-${entry.pot}`}>
                  {parseGroupTask(entry.task)?.task ?? `Friend ${index + 1}`}
                </a>
                <span
                  className={`tag ${entry.joined ? "tag-green" : entry.created ? "tag-yellow" : ""}`}
                >
                  {entry.joined
                    ? "Staked"
                    : entry.created
                      ? "Created"
                      : "Pending"}
                </span>
              </li>
            ))}
          </ul>
          {activePlan.signatures.length || activePlan.pending ? (
            <div className="box-links">
              {activePlan.signatures.map((signature, index) => (
                <a
                  className="link"
                  key={signature}
                  href={transactionUrl(signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Tx {index + 1} ↗
                </a>
              ))}
              {activePlan.pending ? (
                <a
                  className="link"
                  href={transactionUrl(activePlan.pending.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Unresolved tx ↗
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {!complete ? (
        <div className="box">
          {rent !== null && stakeLamports !== null ? (
            <>
              <p className="cost-total">
                <span>Your cost</span>
                <strong>
                  ≈{" "}
                  {formatSol(
                    BigInt(rent * count) +
                      stakeLamports * BigInt(count) +
                      estimatedFees,
                  )}{" "}
                  SOL
                </strong>
              </p>
              <p className="cost-breakdown">
                {formatSol(BigInt(rent * count))} rent +{" "}
                {formatSol(stakeLamports * BigInt(count))} NO stakes + ≤{" "}
                {formatSol(estimatedFees)} fees
                {activePlan ? " · includes confirmed steps" : ""}
              </p>
            </>
          ) : (
            <p className="cost-breakdown">Cost estimate unavailable.</p>
          )}
        </div>
      ) : null}
      {storageError ? (
        <p className="alert-text" role="alert">
          Saved group draft is unreadable.{" "}
          <button
            className="link-button"
            type="button"
            disabled={pending}
            onClick={startAnother}
          >
            Clear draft
          </button>
        </p>
      ) : null}
      {progress ? (
        <p className="status-text" role="status">
          {progress}
        </p>
      ) : null}
      {!complete ? (
        <button
          className="button button-yellow button-block"
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
              ? "Resume setup"
              : `Create ${count} pots + stake NO`}
        </button>
      ) : null}
      {activePlan ? (
        <button
          className="button button-block"
          type="button"
          disabled={pending}
          onClick={() => void copyGroupLink()}
        >
          Copy group link
        </button>
      ) : null}
      {confirmLeave && unstakedPots > 0 ? (
        <p className="alert-text" role="alert">
          {unstakedPots === 1
            ? "1 created pot has"
            : `${unstakedPots} created pots have`}{" "}
          no NO stake from you. Friends joining YES could lose their stake to
          the judge.
        </p>
      ) : null}
      {complete || (activePlan && !activePlan.pending) ? (
        <button
          className="link-button"
          type="button"
          disabled={pending}
          onClick={startAnother}
        >
          {complete
            ? "Start new group"
            : confirmLeave && unstakedPots > 0
              ? "Leave anyway"
              : "Discard and start new group"}
        </button>
      ) : null}
    </form>
  );
}
