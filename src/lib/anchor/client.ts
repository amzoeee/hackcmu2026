import { AnchorProvider, Program, utils } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  SendTransactionError,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { SOLANA_WS_URL } from "../solana";
import idl from "./generated/accountability.json";
import type { Accountability } from "./generated/accountability";

/** Bound public reads without interrupting wallet approval or transaction submission. */
export function getReadOnlyConnection(endpoint: string) {
  return new Connection(endpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }),
  });
}

/** The generated IDL is the source of truth for the program address and API. */
export function getAccountabilityProgram(
  connection: Connection,
  wallet: AnchorWallet,
) {
  const transactionConnection = new Connection(connection.rpcEndpoint, {
    commitment: "confirmed",
    wsEndpoint: SOLANA_WS_URL,
    disableRetryOnRateLimit: true,
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(60_000) }),
  });
  const sendRawTransaction = transactionConnection.sendRawTransaction.bind(
    transactionConnection,
  );
  transactionConnection.sendRawTransaction = async (raw, options) => {
    try {
      return await sendRawTransaction(raw, options);
    } catch (cause) {
      if (cause instanceof SendTransactionError) throw cause;
      let signature: string | undefined;
      try {
        signature = utils.bytes.bs58.encode(
          VersionedTransaction.deserialize(Uint8Array.from(raw)).signatures[0],
        );
      } catch {
        // An unreadable signature still leaves the submission uncertain.
      }
      throw Object.assign(
        new Error(
          "The submission response was lost. This transaction may have succeeded. Check its status and refresh before trying again.",
          { cause },
        ),
        { signature },
      );
    }
  };
  const reader = getReadOnlyConnection(connection.rpcEndpoint);
  transactionConnection.getLatestBlockhash = async (...args) => {
    try {
      return await reader.getLatestBlockhash(...args);
    } catch (cause) {
      throw new Error(
        "Could not prepare the transaction. Check your connection and try again.",
        { cause },
      );
    }
  };
  // Anchor fetches logs for a failed transaction and then rebuilds the error
  // with web3's obsolete positional SendTransactionError constructor, losing
  // them. Translate during that fetch only, so getTransaction stays an ordinary
  // bounded read for every other caller.
  let translateFailedReads = false;
  transactionConnection.getTransaction = async (...args) => {
    // Optional logs must not replace Anchor's known confirmation failure.
    const failedTransaction = await reader
      .getTransaction(...args)
      .catch(() => null);
    if (
      translateFailedReads &&
      failedTransaction?.meta?.err &&
      failedTransaction.meta.logMessages
    ) {
      throw new SendTransactionError({
        action: "send",
        signature: args[0],
        transactionMessage: JSON.stringify(failedTransaction.meta.err),
        logs: failedTransaction.meta.logMessages,
      });
    }
    return failedTransaction;
  };
  const provider = new AnchorProvider(transactionConnection, wallet, {
    commitment: "confirmed",
  });
  const sendAndConfirm = provider.sendAndConfirm.bind(provider);
  provider.sendAndConfirm = async (...args) => {
    translateFailedReads = true;
    try {
      return await sendAndConfirm(...args);
    } finally {
      translateFailedReads = false;
    }
  };
  return new Program<Accountability>(idl as Accountability, provider);
}

/** A public account reader. It cannot sign, so it is safe to use before login. */
export function getReadOnlyAccountabilityProgram(connection: Connection) {
  const readOnlyWallet: AnchorWallet = {
    publicKey: SystemProgram.programId,
    signTransaction: async () => {
      throw new Error("Connect a wallet to sign this transaction.");
    },
    signAllTransactions: async () => {
      throw new Error("Connect a wallet to sign this transaction.");
    },
  };
  const provider = new AnchorProvider(connection, readOnlyWallet, {
    commitment: "confirmed",
  });
  return new Program<Accountability>(idl as Accountability, provider);
}
