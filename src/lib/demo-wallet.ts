import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

const STORAGE_KEY = "solara.devnet.demo-wallet";

export function loadDemoKeypair() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const secret = JSON.parse(stored) as number[];
    if (!Array.isArray(secret) || secret.length !== 64) return null;
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    return null;
  }
}

export function getOrCreateDemoKeypair() {
  const existing = loadDemoKeypair();
  if (existing) return existing;

  const keypair = Keypair.generate();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

export function keypairAnchorWallet(keypair: Keypair): AnchorWallet {
  const signTransaction = async <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> => {
    if (transaction instanceof Transaction) transaction.partialSign(keypair);
    else transaction.sign([keypair]);
    return transaction;
  };

  return {
    publicKey: keypair.publicKey,
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      transactions: T[],
    ) => Promise.all(transactions.map(signTransaction)),
  };
}
