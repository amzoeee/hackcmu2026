import {
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

export const MAX_GROUP_TASK_BYTES = 160;
export const MAX_TRANSACTION_BYTES = 1232;

export type GroupSubmission = {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

/** A transport error is not permission to replay a signed transaction. */
export async function checkGroupSubmission(
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  submission: GroupSubmission,
): Promise<"confirmed" | "failed" | "expired"> {
  const readStatus = async () =>
    (
      await connection.getSignatureStatuses([submission.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
  let status = await readStatus();
  if (status?.err) return "failed";
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  )
    return "confirmed";
  const height = await connection.getBlockHeight("finalized");
  if (
    !Number.isSafeInteger(submission.lastValidBlockHeight) ||
    height <= submission.lastValidBlockHeight
  ) {
    throw Object.assign(
      new Error(
        "The previous transaction is still unresolved. Check its link, then use Resume again after it confirms or expires.",
      ),
      { signature: submission.signature },
    );
  }
  // Recheck after finalized expiry, so a confirmation racing the first read wins.
  status = await readStatus();
  if (status?.err) return "failed";
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  )
    return "confirmed";
  return "expired";
}

/** Base58 keys run 32-44 characters; every group identifier is eight. */
const MAX_ADDRESS_LENGTH = 44;
const PLACEHOLDER_GROUP_ID = "0".repeat(8);

function taggedTask(groupId: string, address: string, task: string) {
  return `[group:${groupId}:${address}] ${task}`;
}

/**
 * The encoded size of one friend's row. An address that does not parse yet
 * counts as a full-length one, so the budget never reads lower than it will be.
 */
export function groupTaskBytes(participant: string, task: string) {
  let address: string;
  try {
    address = new PublicKey(participant.trim()).toBase58();
  } catch {
    address = "1".repeat(MAX_ADDRESS_LENGTH);
  }
  return new TextEncoder().encode(
    taggedTask(PLACEHOLDER_GROUP_ID, address, task.trim()),
  ).length;
}

export function encodeGroupTask(
  groupId: string,
  participant: PublicKey,
  task: string,
) {
  if (!/^[0-9a-f]{8}$/.test(groupId)) {
    throw new Error(
      "A group identifier must contain eight lowercase hex digits.",
    );
  }
  if (!task.trim()) throw new Error("Add a task for every friend.");
  const tagged = taggedTask(groupId, participant.toBase58(), task.trim());
  if (new TextEncoder().encode(tagged).length > MAX_GROUP_TASK_BYTES) {
    throw new Error(
      "Shorten this friend's task: its group tag and task must fit in 160 UTF-8 bytes.",
    );
  }
  return tagged;
}

/** Only our complete, canonical tag is hidden; ordinary task text stays intact. */
export function parseGroupTask(raw: string): {
  groupId: string;
  participant: string;
  task: string;
} | null {
  const match =
    /^\[group:([0-9a-f]{8}):([1-9A-HJ-NP-Za-km-z]{32,44})\] ([\s\S]+)$/.exec(
      raw,
    );
  if (!match) return null;
  const [, groupId, participant, task] = match;
  try {
    const key = new PublicKey(participant);
    if (encodeGroupTask(groupId, key, task) !== raw) return null;
    return { groupId, participant, task };
  } catch {
    return null;
  }
}

/** Keep order and measure the signed wire size, including the organizer's signature. */
export function packGroupTransactions(
  instructions: TransactionInstruction[],
  organizer: PublicKey,
) {
  const batches: Transaction[] = [];
  let current: TransactionInstruction[] = [];
  const fits = (candidate: TransactionInstruction[]) => {
    try {
      return (
        new Transaction({
          feePayer: organizer,
          recentBlockhash: PublicKey.default.toBase58(),
        })
          .add(...candidate)
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .length <= MAX_TRANSACTION_BYTES
      );
    } catch (error) {
      // web3's message encoder also rejects a buffer larger than its packet.
      if (
        error instanceof RangeError ||
        (error instanceof Error && /Transaction too large/.test(error.message))
      )
        return false;
      throw error;
    }
  };

  for (const instruction of instructions) {
    if (
      instruction.keys.some(
        (key) => key.isSigner && !key.pubkey.equals(organizer),
      )
    ) {
      throw new Error(
        "Group setup can only require the organizer's signature.",
      );
    }
    if (!fits([...current, instruction])) {
      if (!fits([instruction])) {
        throw new Error(
          "A group instruction exceeds Solana's 1232-byte transaction limit.",
        );
      }
      if (current.length)
        batches.push(new Transaction({ feePayer: organizer }).add(...current));
      current = [];
    }
    current.push(instruction);
  }
  if (current.length)
    batches.push(new Transaction({ feePayer: organizer }).add(...current));
  return batches;
}
